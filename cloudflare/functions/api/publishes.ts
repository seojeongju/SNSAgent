/**
 * GET /api/publishes?user_id=&limit=
 */
import { corsHeaders, json, type Env } from "../_shared";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);
  const limit = Math.min(Number(url.searchParams.get("limit") || 20), 50);

  const { results } = await context.env.DB.prepare(
    `SELECT id, generation_id, platform, status, title, external_post_id, external_url,
            error_message, created_at, updated_at
     FROM publish_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all();

  return json({ user_id: userId, jobs: results || [] });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
