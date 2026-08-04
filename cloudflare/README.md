# SNSAgent — Cloudflare Pages

Pages에 익숙한 워크플로 기준입니다.

```
cloudflare/
├── public/                 # Pages 정적 산출물 (UI)
├── functions/              # Pages Functions (API)
│   ├── _shared.ts
│   └── api/
│       ├── health.ts       # GET /api/health
│       ├── chat.ts         # GET|POST /api/chat  → D1
│       ├── upload.ts       # POST /api/upload    → R2 + D1
│       └── assets/[[path]].ts  # GET /api/assets/* → R2
├── migrations/             # D1 스키마
└── wrangler.jsonc          # pages_build_output_dir + D1/R2 bindings
```

## 배포 (익숙한 Pages 흐름)

```bash
cd cloudflare
npm install

# 1) 리소스 생성
npm run db:create
npm run r2:create
# wrangler.jsonc 의 database_id 를 생성 결과로 교체

# 2) D1 마이그레이션
npm run db:migrate:local
npm run db:migrate:remote

# 3) 대시보드에서 프로젝트 Bindings 확인 (또는 wrangler.jsonc가 source of truth)
#    DB → D1, ASSETS → R2
#    Secrets: OPENAI_API_KEY, TIKHUB_API_KEY, ...

# 4) 로컬
npm run dev

# 5) 배포
npm run deploy
# 또는 Git 연동 Pages: Root directory = cloudflare, Build output = public
# Functions는 functions/ 자동 인식
```

## Git 연동 Pages 설정 예시

| 항목 | 값 |
|------|-----|
| Root directory | `cloudflare` |
| Build command | (없음 / `echo skip`) |
| Build output directory | `public` |
| Compatibility flags | `nodejs_compat` (필요 시) |

Bindings (Production / Preview 각각):

- **D1** variable `DB` → `snsagent-db`
- **R2** variable `ASSETS` → `snsagent-assets`

## API

| Method | Path | 저장소 |
|--------|------|--------|
| GET | `/api/health` | — |
| GET/POST | `/api/chat` | D1 |
| POST | `/api/upload` | R2 + D1 meta |
| GET | `/api/assets/*` | R2 |

에이전트(Python Reasoning/Action) 실행은 아직 stub입니다. Pages Function에 오케스트레이션을 넣거나, Service Binding으로 별도 Worker/Container에 연결하면 됩니다.
