# Meta(Instagram / Facebook) 게시 연동 가이드

> 대상: Cloudflare Pages 프로젝트 `snsagent`  
> 콜백: `https://snsagent.pages.dev/api/oauth/callback`

SNSAgent는 **토큰 + 공개 영상 URL**이 있으면 Instagram Reels / Facebook 페이지에 Graph API로 게시합니다.  
토큰이 없으면 **수동 게시 패키지**(캡션·URL·안내)를 반환합니다.

---

## 1. Secrets 등록 (Cloudflare Pages)

**Settings → Variables and secrets → Production**

| Secret | 필수 | 설명 |
|--------|------|------|
| `META_APP_ID` | OAuth 시 | Meta 앱 ID |
| `META_APP_SECRET` | OAuth 시 | Meta 앱 Secret |
| `META_REDIRECT_URI` | 권장 | `https://snsagent.pages.dev/api/oauth/callback` |
| `META_ACCESS_TOKEN` | 빠른 테스트 | Page 장기 토큰 |
| `META_IG_USER_ID` | IG 자동게시 | Instagram Business Account ID |
| `META_PAGE_ID` | FB 자동게시 | Facebook Page ID |

배포 후 `/api/diagnostics` 에서 `meta.oauth` / `meta.service_ig` / `meta.service_fb` 가 `true`인지 확인하세요.

---

## 2. Meta 개발자 앱 설정

1. [Meta for Developers](https://developers.facebook.com/) 에서 앱 생성  
2. 제품: **Facebook Login** / **Instagram Graph API**  
3. Valid OAuth Redirect URIs 에 위 `META_REDIRECT_URI` 추가  
4. 권한(권장):
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_posts`
   - `instagram_basic`
   - `instagram_content_publish`
   - `business_management`

App Review 전엔 본인 테스트 사용자/페이지에서만 동작하는 것이 정상입니다.

---

## 3. 계정 연결 방법

### A) UI OAuth (권장)

1. SNSAgent → **계정** 탭  
2. 인스타/페이스북 **OAuth 연결**  
3. 페이지·IG 비즈니스 계정이 연결된 Facebook 계정으로 승인  

### B) 토큰 직접 등록

1. Graph API Explorer 또는 비즈니스 설정에서 **Page Access Token** 발급  
2. 계정 탭 → **토큰 직접 등록**
   - 인스타: Access Token + **IG User ID**
   - 페이스북: Access Token + **Page ID**

### C) 서비스 레벨 Secrets

로컬/단일 브랜드용으로 Pages Secrets에 `META_ACCESS_TOKEN` + `META_IG_USER_ID`(+ `META_PAGE_ID`)만 넣어도 게시 API가 서비스 토큰을 사용합니다.

---

## 4. 게시 전제 조건

1. 스튜디오에서 캡션/대본 생성  
2. **공개 접근 가능**한 영상 URL  
   - SNSAgent **게시** 탭에서 업로드 → `/api/assets/...` URL 자동 입력  
3. Meta가 해당 URL을 pull 할 수 있어야 함 (로그인 벽·만료 URL 불가)

---

## 5. 검증 체크리스트

- [ ] `/api/diagnostics` → `openai: true`, `meta.service_ig` 또는 `oauth: true`
- [ ] 계정 탭에서 연결 상태가 초록 점
- [ ] 짧은 세로 mp4 업로드 후 **게시 요청**
- [ ] 응답 `status: "published"` 또는 Meta 오류 메시지 확인
- [ ] Instagram/Facebook 앱에서 게시물 확인

### 자주 나는 오류

| 메시지 | 조치 |
|--------|------|
| `media_url_required` | 영상 업로드/URL 입력 |
| container `ERROR` | URL이 Meta에서 fetch 불가·포맷 문제 |
| permission 관련 | 토큰 권한·App Review·페이지 역할 확인 |
| IG business 없음 | 페이지에 Instagram 비즈니스 계정 연결 |

---

## 6. 참고 API

| Method | Path |
|--------|------|
| GET | `/api/diagnostics` |
| GET/POST/DELETE | `/api/accounts` |
| GET | `/api/oauth/instagram` · `/api/oauth/facebook` |
| POST | `/api/publish` |
