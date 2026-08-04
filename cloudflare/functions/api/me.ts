import { corsHeaders, json, type Env } from "../_shared";
import { ensureUser, getQuota } from "../_billing";

/**
 * GET /api/me?user_id=
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id") ?? "user_demo";

  await ensureUser(context.env, userId);
  const quota = await getQuota(context.env, userId);

  const user = await context.env.DB.prepare(
    `SELECT id, email, display_name, plan_code, created_at FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first();

  return json({
    user,
    quota,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
