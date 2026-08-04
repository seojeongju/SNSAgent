/**
 * POST /api/auth/logout
 */
import { corsHeaders, type Env } from "../../_shared";
import { clearSessionCookieHeader, destroyAuthSession } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  await destroyAuthSession(context.env, context.request);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
    "Set-Cookie": clearSessionCookieHeader(),
  });
  return new Response(JSON.stringify({ ok: true }), { headers });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
