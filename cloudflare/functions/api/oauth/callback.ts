/**
 * GET /api/oauth/callback?code=&state=
 * Exchanges OAuth code and stores platform_accounts.
 */
import { appBase, corsHeaders, json, type Env } from "../../_shared";
import { ensureUser } from "../../_billing";

type StatePayload = {
  user_id: string;
  platform: "instagram_reels" | "facebook" | "youtube_shorts" | "tiktok";
  nonce: string;
};

function htmlDone(ok: boolean, message: string, base: string): Response {
  const body = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>계정 연결</title>
<style>
  body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f4f1ec;color:#171513}
  .card{background:#fffdf9;border:1px solid rgba(23,21,19,.12);border-radius:14px;padding:1.5rem 1.75rem;max-width:26rem;box-shadow:0 18px 50px rgba(23,21,19,.08)}
  a{color:#0f766e;font-weight:600}
  .ok{color:#0f766e}.err{color:#b42318}
</style></head>
<body><div class="card">
  <h1 style="margin:0 0 .5rem;font-size:1.2rem">${ok ? "연결 완료" : "연결 실패"}</h1>
  <p class="${ok ? "ok" : "err"}">${message}</p>
  <p><a href="${base}/#publish">스튜디오로 돌아가기</a></p>
  <script>setTimeout(()=>{location.href="${base}/#publish"},1800)</script>
</div></body></html>`;
  return new Response(body, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function upsertAccount(
  env: Env,
  userId: string,
  platform: string,
  data: {
    access_token: string;
    refresh_token?: string | null;
    account_id?: string | null;
    account_name?: string | null;
    metadata?: Record<string, unknown>;
    token_expires_at?: string | null;
  },
) {
  await ensureUser(env, userId);
  await env.DB.prepare(
    `INSERT INTO platform_accounts
      (id, user_id, platform, account_id, account_name, access_token, refresh_token, token_expires_at, metadata_json, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'connected', datetime('now'))
     ON CONFLICT(user_id, platform) DO UPDATE SET
       account_id = excluded.account_id,
       account_name = excluded.account_name,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, platform_accounts.refresh_token),
       token_expires_at = excluded.token_expires_at,
       metadata_json = excluded.metadata_json,
       status = 'connected',
       updated_at = datetime('now')`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      platform,
      data.account_id || null,
      data.account_name || null,
      data.access_token,
      data.refresh_token || null,
      data.token_expires_at || null,
      data.metadata ? JSON.stringify(data.metadata) : null,
    )
    .run();
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const base = appBase(context.request, context.env);
  const err = url.searchParams.get("error");
  if (err) return htmlDone(false, `OAuth 오류: ${err}`, base);

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  if (!code || !stateRaw) return htmlDone(false, "code/state 누락", base);

  let state: StatePayload;
  try {
    state = JSON.parse(atob(stateRaw)) as StatePayload;
  } catch {
    return htmlDone(false, "state 파싱 실패", base);
  }

  const redirectUri =
    context.env.META_REDIRECT_URI ||
    context.env.GOOGLE_REDIRECT_URI ||
    context.env.TIKTOK_REDIRECT_URI ||
    `${base}/api/oauth/callback`;

  try {
    if (state.platform === "instagram_reels" || state.platform === "facebook") {
      if (!context.env.META_APP_ID || !context.env.META_APP_SECRET) {
        return htmlDone(false, "Meta 앱이 설정되지 않았습니다.", base);
      }
      const tokenUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      tokenUrl.searchParams.set("client_id", context.env.META_APP_ID);
      tokenUrl.searchParams.set("client_secret", context.env.META_APP_SECRET);
      tokenUrl.searchParams.set("redirect_uri", context.env.META_REDIRECT_URI || redirectUri);
      tokenUrl.searchParams.set("code", code);
      const tokenRes = await fetch(tokenUrl.toString());
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        error?: { message?: string };
      };
      if (!tokenJson.access_token) {
        return htmlDone(false, tokenJson.error?.message || "토큰 교환 실패", base);
      }

      // long-lived user token
      const llUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      llUrl.searchParams.set("grant_type", "fb_exchange_token");
      llUrl.searchParams.set("client_id", context.env.META_APP_ID);
      llUrl.searchParams.set("client_secret", context.env.META_APP_SECRET);
      llUrl.searchParams.set("fb_exchange_token", tokenJson.access_token);
      const llRes = await fetch(llUrl.toString());
      const llJson = (await llRes.json()) as { access_token?: string; expires_in?: number };
      const userToken = llJson.access_token || tokenJson.access_token;

      const pagesRes = await fetch(
        `https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userToken)}`,
      );
      const pagesJson = (await pagesRes.json()) as {
        data?: Array<{
          id: string;
          name: string;
          access_token: string;
          instagram_business_account?: { id: string };
        }>;
      };
      const page = pagesJson.data?.[0];
      if (!page) {
        return htmlDone(false, "연결 가능한 Facebook 페이지가 없습니다.", base);
      }

      if (state.platform === "instagram_reels") {
        const igId = page.instagram_business_account?.id;
        if (!igId) {
          return htmlDone(
            false,
            "페이지에 Instagram 비즈니스 계정이 연결되어 있지 않습니다.",
            base,
          );
        }
        await upsertAccount(context.env, state.user_id, "instagram_reels", {
          access_token: page.access_token,
          account_id: igId,
          account_name: page.name,
          metadata: { page_id: page.id, ig_user_id: igId },
        });
        // also store facebook page for convenience
        await upsertAccount(context.env, state.user_id, "facebook", {
          access_token: page.access_token,
          account_id: page.id,
          account_name: page.name,
          metadata: { page_id: page.id, ig_user_id: igId },
        });
        return htmlDone(true, `인스타그램(${page.name}) 연결됨`, base);
      }

      await upsertAccount(context.env, state.user_id, "facebook", {
        access_token: page.access_token,
        account_id: page.id,
        account_name: page.name,
        metadata: { page_id: page.id },
      });
      return htmlDone(true, `페이스북 페이지(${page.name}) 연결됨`, base);
    }

    if (state.platform === "youtube_shorts") {
      if (!context.env.GOOGLE_CLIENT_ID || !context.env.GOOGLE_CLIENT_SECRET) {
        return htmlDone(false, "Google OAuth가 설정되지 않았습니다.", base);
      }
      const body = new URLSearchParams({
        code,
        client_id: context.env.GOOGLE_CLIENT_ID,
        client_secret: context.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: context.env.GOOGLE_REDIRECT_URI || redirectUri,
        grant_type: "authorization_code",
      });
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const tokenJson = (await tokenRes.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
      };
      if (!tokenJson.access_token) {
        return htmlDone(false, tokenJson.error || "YouTube 토큰 교환 실패", base);
      }
      const chRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { Authorization: `Bearer ${tokenJson.access_token}` } },
      );
      const chJson = (await chRes.json()) as {
        items?: Array<{ id: string; snippet?: { title?: string } }>;
      };
      const ch = chJson.items?.[0];
      const expiresAt = tokenJson.expires_in
        ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
        : null;
      await upsertAccount(context.env, state.user_id, "youtube_shorts", {
        access_token: tokenJson.access_token,
        refresh_token: tokenJson.refresh_token,
        account_id: ch?.id || null,
        account_name: ch?.snippet?.title || "YouTube",
        token_expires_at: expiresAt,
        metadata: { channel_id: ch?.id },
      });
      return htmlDone(true, `유튜브(${ch?.snippet?.title || "채널"}) 연결됨`, base);
    }

    // TikTok
    if (!context.env.TIKTOK_CLIENT_KEY || !context.env.TIKTOK_CLIENT_SECRET) {
      return htmlDone(false, "TikTok OAuth가 설정되지 않았습니다.", base);
    }
    const tkBody = new URLSearchParams({
      client_key: context.env.TIKTOK_CLIENT_KEY,
      client_secret: context.env.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: context.env.TIKTOK_REDIRECT_URI || redirectUri,
    });
    const tkRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tkBody,
    });
    const tkJson = (await tkRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      open_id?: string;
      error?: string;
      error_description?: string;
    };
    if (!tkJson.access_token) {
      return htmlDone(
        false,
        tkJson.error_description || tkJson.error || "TikTok 토큰 교환 실패",
        base,
      );
    }
    const expiresAt = tkJson.expires_in
      ? new Date(Date.now() + tkJson.expires_in * 1000).toISOString()
      : null;
    await upsertAccount(context.env, state.user_id, "tiktok", {
      access_token: tkJson.access_token,
      refresh_token: tkJson.refresh_token,
      account_id: tkJson.open_id || null,
      account_name: "TikTok",
      token_expires_at: expiresAt,
      metadata: { open_id: tkJson.open_id },
    });
    return htmlDone(true, "틱톡 계정 연결됨", base);
  } catch (e) {
    return htmlDone(false, String(e), base);
  }
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
