/**
 * POST /api/publish
 * Body: {
 *   user_id, platform, generation_id?,
 *   caption?, title?,
 *   media_url?, media_r2_key?,
 *   force_manual?
 * }
 */
import { appBase, corsHeaders, json, type Env } from "../_shared";
import { ensureUser } from "../_billing";
import {
  extractCaptionFromGeneration,
  publishToPlatform,
  type AccountRow,
  type PublishPlatform,
} from "../_publish";

const PLATFORMS = new Set<PublishPlatform>([
  "instagram_reels",
  "youtube_shorts",
  "tiktok",
  "facebook",
]);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestId = crypto.randomUUID();
  const body = (await context.request.json()) as {
    user_id?: string;
    platform?: string;
    generation_id?: string;
    caption?: string;
    title?: string;
    media_url?: string;
    media_r2_key?: string;
    force_manual?: boolean;
  };

  const userId = (body.user_id || "").trim();
  const platform = (body.platform || "").trim() as PublishPlatform;
  if (!userId) return json({ error: "user_id required", request_id: requestId }, 400);
  if (!PLATFORMS.has(platform)) {
    return json(
      {
        error: "platform must be instagram_reels | youtube_shorts | tiktok | facebook",
        request_id: requestId,
      },
      400,
    );
  }

  await ensureUser(context.env, userId);

  let caption = (body.caption || "").trim();
  let title = body.title?.trim();
  let generationId = body.generation_id || null;

  if (generationId && (!caption || !title)) {
    const gen = await context.env.DB.prepare(
      `SELECT result_json, platform FROM generations WHERE id = ? AND user_id = ?`,
    )
      .bind(generationId, userId)
      .first<{ result_json: string; platform: string }>();

    if (!gen) {
      return json({ error: "generation_not_found", request_id: requestId }, 404);
    }
    const extracted = extractCaptionFromGeneration(
      platform,
      JSON.parse(gen.result_json),
    );
    if (!caption) caption = extracted.caption;
    if (!title) title = extracted.title;
  }

  if (!caption) {
    return json(
      { error: "caption required (또는 generation_id)", request_id: requestId },
      400,
    );
  }

  const base = appBase(context.request, context.env);
  let mediaUrl = (body.media_url || "").trim();
  let mediaR2Key = (body.media_r2_key || "").trim() || null;

  if (!mediaUrl && mediaR2Key) {
    mediaUrl = `${base}/api/assets/${mediaR2Key}`;
  }

  if (!mediaUrl) {
    return json(
      {
        error: "media_url_required",
        message:
          "공개 접근 가능한 영상 URL(media_url) 또는 R2 키(media_r2_key)가 필요합니다. 먼저 /api/upload 로 영상을 올리세요.",
        request_id: requestId,
      },
      400,
    );
  }

  // If R2 key provided without absolute URL shape, ensure asset path
  if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) {
    mediaR2Key = mediaUrl.replace(/^\/?api\/assets\//, "");
    mediaUrl = `${base}/api/assets/${mediaR2Key}`;
  }

  const account = await context.env.DB.prepare(
    `SELECT id, user_id, platform, account_id, account_name, access_token, refresh_token, metadata_json, status
     FROM platform_accounts
     WHERE user_id = ? AND platform = ?`,
  )
    .bind(userId, platform)
    .first<AccountRow>();

  const jobId = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO publish_jobs
      (id, user_id, generation_id, platform, status, caption, title, media_r2_key, media_url)
     VALUES (?, ?, ?, ?, 'processing', ?, ?, ?, ?)`,
  )
    .bind(
      jobId,
      userId,
      generationId,
      platform,
      caption,
      title || null,
      mediaR2Key,
      mediaUrl,
    )
    .run();

  const result = await publishToPlatform({
    platform,
    caption,
    title,
    mediaUrl,
    account: body.force_manual ? null : account,
    env: body.force_manual
      ? { ...context.env, META_ACCESS_TOKEN: undefined, META_IG_USER_ID: undefined, META_PAGE_ID: undefined }
      : context.env,
  });

  await context.env.DB.prepare(
    `UPDATE publish_jobs
     SET status = ?,
         external_post_id = ?,
         external_url = ?,
         error_message = ?,
         result_json = ?,
         updated_at = datetime('now')
     WHERE id = ?`,
  )
    .bind(
      result.status,
      result.external_post_id || null,
      result.external_url || null,
      result.error_message || null,
      JSON.stringify({
        result: result.result || null,
        manual_package: result.manual_package || null,
      }),
      jobId,
    )
    .run();

  return json({
    request_id: requestId,
    job_id: jobId,
    platform,
    status: result.status,
    external_post_id: result.external_post_id || null,
    external_url: result.external_url || null,
    error_message: result.error_message || null,
    manual_package: result.manual_package || null,
    account_connected: Boolean(account?.access_token) ||
      (platform === "instagram_reels" &&
        Boolean(context.env.META_ACCESS_TOKEN && context.env.META_IG_USER_ID)) ||
      (platform === "facebook" &&
        Boolean(context.env.META_ACCESS_TOKEN && context.env.META_PAGE_ID)),
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
