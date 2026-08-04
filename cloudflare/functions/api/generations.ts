import { corsHeaders, json, type Env } from "../_shared";

/**
 * GET /api/generations?user_id=&limit=
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);

  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);

  const { results } = await context.env.DB.prepare(
    `SELECT id, platform, content_type, topic, tone, r2_key, created_at
     FROM generations
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all();

  return json({ user_id: userId, generations: results });
};

/**
 * GET /api/generations/:id?user_id=
 * Implemented via optional query on same path group — use /api/generation
 */
export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
