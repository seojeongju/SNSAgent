# SNSAgent — Cloudflare Pages

Pages에 익숙한 워크플로 기준입니다.

```
cloudflare/
├── public/                 # Pages 정적 산출물 (UI)
├── functions/              # Pages Functions (API)
│   ├── _shared.ts
│   ├── _billing.ts
│   ├── _content.ts
│   ├── _publish.ts
│   └── api/
│       ├── health.ts
│       ├── generate.ts / generations.ts / generation/[id].ts
│       ├── accounts.ts     # 플랫폼 계정
│       ├── publish.ts / publishes.ts / publish/[id].ts
│       ├── oauth/[platform].ts / oauth/callback.ts
│       ├── upload.ts / assets/[[path]].ts
│       └── chat.ts / me.ts
├── migrations/             # D1 스키마 (0001~0003)
└── wrangler.jsonc
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

# 3) 대시보드에서 프로젝트 Bindings 확인
#    DB → D1, MEDIA → R2
#    Secrets: OPENAI_API_KEY, META_*, GOOGLE_*, TIKTOK_*

# 4) 로컬
npm run dev

# 5) 배포
npm run deploy
# 또는 Git 연동: Root = cloudflare, Build output = public
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
- **R2** variable `MEDIA` → `snsagent-assets`

## API

| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/health` | 헬스 |
| POST | `/api/generate` | 한국어 대본/캡션 생성 |
| GET | `/api/generations` | 생성 이력 |
| GET/POST/DELETE | `/api/accounts` | 플랫폼 계정 연결 |
| GET | `/api/diagnostics` | Secrets/연동 준비 상태 |
| GET | `/api/oauth/:platform` | OAuth 시작 |
| GET | `/api/oauth/callback` | OAuth 콜백 |
| POST | `/api/publish` | 게시 |
| POST | `/api/auth/signup` · `/login` · `/logout` | 회원 |
| POST | `/api/billing/checkout` · `/portal` · `/webhook` | Stripe |

## 게시 연동 Secrets

| Secret | 용도 |
|--------|------|
| `META_APP_ID` / `META_APP_SECRET` | Meta OAuth |
| `META_REDIRECT_URI` | 예: `https://snsagent.pages.dev/api/oauth/callback` |
| `META_ACCESS_TOKEN` + `META_IG_USER_ID` | (선택) 서비스 레벨 IG 게시 |
| `META_PAGE_ID` | (선택) 서비스 레벨 Facebook 게시 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube OAuth |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok OAuth |

토큰 없이도 **수동 게시 패키지**(캡션+영상 URL+안내)는 바로 사용 가능합니다.
Instagram/Facebook은 토큰+공개 `video_url` 이 있으면 Graph API로 자동 게시합니다.
