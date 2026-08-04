/**
 * GET  /api/accounts?user_id=
 * POST /api/accounts  { user_id, platform, access_token, account_id?, account_name?, metadata? }
 * DELETE /api/accounts?user_id=&platform=
 */
import { corsHeaders, json, type Env } from "../_shared";
import { ensureUser } from "../_billing";

const PLATFORMS = new Set([
  "instagram_reels",
  "youtube_shorts",
  "tiktok",
  "facebook",
]);

function maskToken(token: string | null): string | null {
  if (!token) return null;
  if (token.length <= 8) return "••••";
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);

  await ensureUser(context.env, userId);

  const { results } = await context.env.DB.prepare(
    `SELECT id, platform, account_id, account_name, access_token, status, metadata_json, updated_at, created_at
     FROM platform_accounts
     WHERE user_id = ?
     ORDER BY platform`,
  )
    .bind(userId)
    .all<{
      id: string;
      platform: string;
      account_id: string | null;
      account_name: string | null;
      access_token: string | null;
      status: string;
      metadata_json: string | null;
      updated_at: string;
      created_at: string;
    }>();

  const accounts = (results || []).map((a) => ({
    id: a.id,
    platform: a.platform,
    account_id: a.account_id,
    account_name: a.account_name,
    status: a.status,
    has_token: Boolean(a.access_token),
    token_preview: maskToken(a.access_token),
    metadata: a.metadata_json ? JSON.parse(a.metadata_json) : null,
    updated_at: a.updated_at,
    created_at: a.created_at,
  }));

  // Env-level Meta service tokens count as connected when no per-user account
  const envHints: Record<string, boolean> = {
    instagram_reels: Boolean(context.env.META_ACCESS_TOKEN && context.env.META_IG_USER_ID),
    facebook: Boolean(context.env.META_ACCESS_TOKEN && context.env.META_PAGE_ID),
    youtube_shorts: Boolean(context.env.GOOGLE_CLIENT_ID),
    tiktok: Boolean(context.env.TIKTOK_CLIENT_KEY),
  };

  return json({ user_id: userId, accounts, env_hints: envHints });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    user_id?: string;
    platform?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
    account_name?: string;
    metadata?: Record<string, unknown>;
  };

  const userId = (body.user_id || "").trim();
  const platform = (body.platform || "").trim();
  const accessToken = (body.access_token || "").trim();

  if (!userId) return json({ error: "user_id required" }, 400);
  if (!PLATFORMS.has(platform)) {
    return json(
      { error: "platform must be instagram_reels | youtube_shorts | tiktok | facebook" },
      400,
    );
  }
  if (!accessToken) return json({ error: "access_token required" }, 400);

  await ensureUser(context.env, userId);

  const id = crypto.randomUUID();
  const metadataJson = body.metadata ? JSON.stringify(body.metadata) : null;

  await context.env.DB.prepare(
    `INSERT INTO platform_accounts
      (id, user_id, platform, account_id, account_name, access_token, refresh_token, metadata_json, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'connected', datetime('now'))
     ON CONFLICT(user_id, platform) DO UPDATE SET
       account_id = excluded.account_id,
       account_name = excluded.account_name,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, platform_accounts.refresh_token),
       metadata_json = COALESCE(excluded.metadata_json, platform_accounts.metadata_json),
       status = 'connected',
       updated_at = datetime('now')`,
  )
    .bind(
      id,
      userId,
      platform,
      body.account_id || null,
      body.account_name || null,
      accessToken,
      body.refresh_token || null,
      metadataJson,
    )
    .run();

  return json({
    ok: true,
    platform,
    account_id: body.account_id || null,
    account_name: body.account_name || null,
    status: "connected",
  });
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  const platform = url.searchParams.get("platform");
  if (!userId || !platform) {
    return json({ error: "user_id and platform required" }, 400);
  }
  if (!PLATFORMS.has(platform)) return json({ error: "invalid platform" }, 400);

  await context.env.DB.prepare(
    `DELETE FROM platform_accounts WHERE user_id = ? AND platform = ?`,
  )
    .bind(userId, platform)
    .run();

  return json({ ok: true, platform });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
