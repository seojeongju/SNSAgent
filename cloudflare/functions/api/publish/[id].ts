/**
 * GET /api/publish/:id?user_id=
 */
import { corsHeaders, json, type Env } from "../../_shared";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id as string;
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);

  const row = await context.env.DB.prepare(
    `SELECT id, user_id, generation_id, platform, status, caption, title,
            media_r2_key, media_url, external_post_id, external_url,
            error_message, result_json, created_at, updated_at
     FROM publish_jobs
     WHERE id = ? AND user_id = ?`,
  )
    .bind(id, userId)
    .first<{
      id: string;
      user_id: string;
      generation_id: string | null;
      platform: string;
      status: string;
      caption: string | null;
      title: string | null;
      media_r2_key: string | null;
      media_url: string | null;
      external_post_id: string | null;
      external_url: string | null;
      error_message: string | null;
      result_json: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!row) return json({ error: "not_found" }, 404);

  return json({
    ...row,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    result_json: undefined,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
