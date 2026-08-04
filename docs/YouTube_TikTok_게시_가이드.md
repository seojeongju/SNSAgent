# YouTube Shorts · TikTok 자동 게시 가이드

SNSAgent는 계정 OAuth 토큰이 있으면 공개 영상 URL로 **자동 업로드**를 시도합니다.

---

## 공통 전제

1. **회원·구독** 탭에서 로그인 (권장)  
2. **계정** 탭에서 YouTube / TikTok OAuth 연결  
3. **게시** 탭에서 세로 영상 업로드 (권장 **40MB 이하**)  
4. 캡션/생성 ID 확인 후 **게시 요청**

영상은 `/api/assets/...` 로 공개 fetch 가능해야 합니다.

---

## YouTube Shorts

### Secrets
| Secret | 설명 |
|--------|------|
| `GOOGLE_CLIENT_ID` | Google Cloud OAuth 클라이언트 |
| `GOOGLE_CLIENT_SECRET` | 클라이언트 시크릿 |
| `GOOGLE_REDIRECT_URI` | `https://snsagent.pages.dev/api/oauth/callback` |

### Google Cloud 설정
1. YouTube Data API v3 활성화  
2. OAuth 동의 화면 + 테스트 사용자  
3. Scope: `youtube.upload`, `youtube.readonly`  
4. Redirect URI를 위 콜백으로 등록  

### 동작
- Data API **resumable upload**
- 제목에 `#Shorts` 자동 첨부
- 토큰 만료 시 `refresh_token`으로 갱신 후 D1 저장

### 확인
계정 연결 → 짧은 Shorts용 mp4 업로드 → 게시 플랫폼 **유튜브 쇼츠** → `status: published`  
URL 예: `https://youtube.com/shorts/{videoId}`

---

## TikTok

### Secrets
| Secret | 설명 |
|--------|------|
| `TIKTOK_CLIENT_KEY` | TikTok 앱 키 |
| `TIKTOK_CLIENT_SECRET` | 시크릿 |
| `TIKTOK_REDIRECT_URI` | `https://snsagent.pages.dev/api/oauth/callback` |
| `TIKTOK_USE_PULL_URL` | 기본 활성. `0`이면 항상 FILE_UPLOAD |
| `TIKTOK_PRIVACY_LEVEL` | 선택. creator options 내 값 (예: `SELF_ONLY`) |

### TikTok Developer 설정
1. Content Posting API / Login Kit 활성화  
2. Scopes: `user.info.basic`, `video.upload`, `video.publish`  
3. **App Review** 전: 비공개(`SELF_ONLY`) 또는 **Inbox** 업로드만 가능할 수 있음  
4. `PULL_FROM_URL` 사용 시 도메인 URL ownership 검증 필요  

### 동작 순서
1. creator_info로 허용 privacy 조회  
2. `PULL_FROM_URL` 시도 (공개 HTTPS URL)  
3. 실패 시 `FILE_UPLOAD`  
4. Direct Post 불가 시 **Inbox** init으로 폴백 (앱에서 확인 후 게시)

### 확인
`/api/diagnostics` → `tiktok.oauth: true`  
게시 후 `status: published` 또는 Inbox 안내

---

## 제한

| 항목 | 값 |
|------|-----|
| 자동 게시 권장 용량 | ≤ 40MB |
| 초과 시 | 오류 메시지 또는 수동 패키지 |
| Workers 실행 시간 | 긴 업로드는 실패할 수 있음 → 짧은 Shorts 권장 |

---

## 문제 해결

| 증상 | 조치 |
|------|------|
| `manual_ready` | OAuth 미연결 → 계정 탭 연결 |
| YouTube 401 / 만료 | 재연결 (refresh_token 포함 동의) |
| TikTok init 실패 | Scope·App Review·privacy 확인 |
| PULL_FROM_URL 실패 | `TIKTOK_USE_PULL_URL=0` 으로 FILE_UPLOAD 강제 |
| 영상 너무 큼 | 40MB 이하로 재업로드 |
