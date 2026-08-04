import { corsHeaders, json, type Env } from "../../_shared";

/**
 * GET /api/generation/[id]?user_id=
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const id = context.params.id;
  const generationId = Array.isArray(id) ? id[0] : id;
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");

  if (!generationId) return json({ error: "id required" }, 400);
  if (!userId) return json({ error: "user_id required" }, 400);

  const row = await context.env.DB.prepare(
    `SELECT id, user_id, platform, content_type, topic, tone, result_json, r2_key, openai_usage_json, created_at
     FROM generations
     WHERE id = ? AND user_id = ?`,
  )
    .bind(generationId, userId)
    .first<{
      id: string;
      user_id: string;
      platform: string;
      content_type: string;
      topic: string;
      tone: string | null;
      result_json: string;
      r2_key: string | null;
      openai_usage_json: string | null;
      created_at: string;
    }>();

  if (!row) return json({ error: "not found" }, 404);

  let result: unknown = null;
  try {
    result = JSON.parse(row.result_json);
  } catch {
    result = row.result_json;
  }

  return json({
    id: row.id,
    user_id: row.user_id,
    platform: row.platform,
    content_type: row.content_type,
    topic: row.topic,
    tone: row.tone,
    r2_key: row.r2_key,
    created_at: row.created_at,
    result,
    usage: row.openai_usage_json ? JSON.parse(row.openai_usage_json) : null,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
