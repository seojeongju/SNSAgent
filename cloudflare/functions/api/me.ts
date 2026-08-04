import { corsHeaders, json, type Env } from "../_shared";
import { resolveUserId } from "../_auth";
import { getQuota } from "../_billing";

/**
 * GET /api/me?user_id=
 * Cookie session 우선, 없으면 guest user_id.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const fallback = url.searchParams.get("user_id");
  const { userId, auth } = await resolveUserId(
    context.env,
    context.request,
    fallback,
  );
  const quota = await getQuota(context.env, userId);

  const user = await context.env.DB.prepare(
    `SELECT id, email, display_name, plan_code, created_at FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first();

  return json({
    user,
    auth,
    authenticated: Boolean(auth),
    quota,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
