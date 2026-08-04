# SNSAgent Cloudflare Pages 배포 설계

> 배포: **Cloudflare Pages** + **Pages Functions** + **D1** + **R2**  
> 기준일: 2026-08-04

Pages에 익숙한 흐름을 기준으로 합니다. (Git 연동 / `wrangler pages deploy` / Dashboard Bindings)

---

## 1. 전체 구조

```
[ Browser ]
    │
    ▼
[ Cloudflare Pages ]
    ├── public/              정적 UI
    └── functions/api/*      Pages Functions
            │
            ├── D1 (DB)      채팅·워크플로·비용·아티팩트 메타
            ├── R2 (ASSETS)  업로드·출력·미디어
            └── Secrets      OPENAI_API_KEY, TIKHUB_API_KEY, ...
```

| 현재 Python | Pages 대응 |
|-------------|------------|
| Streamlit UI | `public/` 웹 UI (점진 확장) |
| Memory 인메모리 | **D1** |
| 로컬 파일/출력 | **R2** |
| FastAPI | **Pages Functions** (`/api/*`) |
| `.env` | Pages **Secrets** / Variables |

> Streamlit 앱 자체는 Pages에 올라가지 않습니다. UI는 정적(or 프론트 프레임워크) + Functions API로 가져갑니다.

---

## 2. 레포 위치

```
cloudflare/
├── public/                 # Build output (= pages_build_output_dir)
├── functions/api/          # /api/health, /api/chat, /api/upload, /api/assets
├── migrations/0001_init.sql
└── wrangler.jsonc
```

상세 명령: [`cloudflare/README.md`](../cloudflare/README.md)

---

## 3. D1 / R2

### D1 (`DB`)

- `users`, `sessions`, `chat_messages`
- `workflows`, `workflow_steps`
- `api_costs`, `artifacts` (R2 키 메타)

### R2 (`ASSETS`)

| 키 프리픽스 | 용도 |
|-------------|------|
| `uploads/...` | 사용자 업로드 |
| `outputs/...` | 워크플로 결과 |
| `media/...` | 이미지·영상 |
| `scripts/...` | 릴스/쇼츠 JSON |

---

## 4. Pages 배포 체크리스트 (익숙한 순서)

1. Cloudflare Dashboard에서 Pages 프로젝트 `snsagent` 생성 (또는 `wrangler pages deploy`)
2. `wrangler d1 create snsagent-db` → `database_id`를 `wrangler.jsonc`에 기입
3. `wrangler r2 bucket create snsagent-assets`
4. `wrangler d1 migrations apply snsagent-db --remote`
5. **Settings → Bindings**
   - D1: `DB` → `snsagent-db`
   - R2: `ASSETS` → `snsagent-assets`
6. **Settings → Variables and Secrets** — API 키 등록
7. Git 연동 시 Root = `cloudflare`, Output = `public`
8. 배포 후 `/api/health` 확인

로컬:

```bash
cd cloudflare
npm install
npm run db:migrate:local
npm run dev
```

---

## 5. 에이전트 로직을 어디에 둘지

Pages Functions는 짧은 API·D1/R2에 적합합니다.  
LLM 워크플로·TikHub 크롤 등 무거운 작업은:

| 옵션 | 설명 |
|------|------|
| **Functions 안에 단계적 이식** | 릴스/쇼츠 생성부터 OpenAI `fetch`로 Functions에서 처리 (빠름) |
| **Service Binding → Worker** | 별도 Worker에 오케스트레이션, Pages는 UI+얇은 API |
| **Container** | 기존 Python 유지가 필요할 때 |

1단계 권장: Pages에서 **채팅 저장(D1) + 업로드(R2) + 한국어 대본/캡션 생성(OpenAI)** 부터 Functions로 옮기고, 크롤/게시는 이후 연결.

---

## 6. 참고

- Pages Bindings: https://developers.cloudflare.com/pages/functions/bindings/
- Pages Wrangler config: https://developers.cloudflare.com/pages/functions/wrangler-configuration/
- (선택) 신규 프로젝트는 Workers + Assets로도 가능하나, 익숙한 Pages 워크플로를 유지합니다.
