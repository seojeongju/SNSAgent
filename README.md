<p align="center">
  <img src="images/snsagent_logo.png" alt="SNSAgent logo" width="120" height="120">
</p>

# SNSAgent

한국어 숏폼(인스타 릴스 · 유튜브 쇼츠 · 틱톡 · 페이스북) **대본·캡션 생성**과 **게시 연동**을 위한 에이전트.

**라이브:** https://snsagent.pages.dev  
**스택:** Cloudflare Pages + Functions + D1 + R2

---

## 지금 되는 것

| 기능 | 설명 |
|------|------|
| 스튜디오 | 4플랫폼 한국어 대본/캡션 생성 (`/api/generate`) |
| 이력 | 생성 결과 저장·조회 (D1 + R2) |
| 게시 | 영상 업로드 후 Meta 자동게시 또는 수동 패키지 |
| 계정 연동 | Meta / Google / TikTok OAuth + 토큰 등록 |
| 회원 | 이메일 회원가입·로그인 (쿠키 세션) |
| 구독 | Stripe Checkout / Portal / Webhook (Secrets 설정 시) |

---

## 빠른 시작 (Cloudflare)

```bash
git clone https://github.com/seojeongju/SNSAgent.git
cd SNSAgent/cloudflare
npm install
npm run db:migrate:local
npm run dev
```

Git 연동 Pages 설정:

| 항목 | 값 |
|------|-----|
| Root directory | `cloudflare` |
| Build output | `public` |
| Bindings | D1 `DB`, R2 `MEDIA` |

상세: [`cloudflare/README.md`](cloudflare/README.md) · [`docs/cloudflare_배포_설계.md`](docs/cloudflare_배포_설계.md)

---

## Secrets (Production)

| Secret | 용도 |
|--------|------|
| `OPENAI_API_KEY` | 콘텐츠 생성 (필수) |
| `META_APP_ID` / `META_APP_SECRET` / `META_REDIRECT_URI` | Meta OAuth |
| `META_ACCESS_TOKEN` + `META_IG_USER_ID` / `META_PAGE_ID` | 서비스 레벨 자동게시 |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | YouTube OAuth |
| `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` | TikTok OAuth |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PRO` | Pro 구독 |

연동 상태 확인: `GET /api/diagnostics`  
- Meta: [`docs/Meta_연동_가이드.md`](docs/Meta_연동_가이드.md)  
- YouTube · TikTok: [`docs/YouTube_TikTok_게시_가이드.md`](docs/YouTube_TikTok_게시_가이드.md)

Stripe Webhook 엔드포인트: `https://snsagent.pages.dev/api/billing/webhook`  
이벤트: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## 문서

- [`docs/기능_설명서.md`](docs/기능_설명서.md)
- [`docs/SaaS_개발계획.md`](docs/SaaS_개발계획.md)
- [`docs/Meta_연동_가이드.md`](docs/Meta_연동_가이드.md)

---

## 레거시 Python

루트의 `agents/`, `common/`, `core/`, `run_agent_*.py` 는 참고용 레거시입니다.  
**제품 런타임은 `cloudflare/` 만 사용합니다.**

---

## License

Apache 2.0 — see [LICENSE](LICENSE)
