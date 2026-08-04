/**
 * POST /api/auth/login
 * { email, password }
 */
import { corsHeaders, json, type Env } from "../../_shared";
import {
  createAuthSession,
  sessionCookieHeader,
  verifyPassword,
} from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    email?: string;
    password?: string;
  };
  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  if (!email || !password) return json({ error: "email_password_required" }, 400);

  const row = await context.env.DB.prepare(
    `SELECT id, email, display_name, plan_code, password_hash, password_salt
     FROM users WHERE email = ?`,
  )
    .bind(email)
    .first<{
      id: string;
      email: string;
      display_name: string | null;
      plan_code: string;
      password_hash: string | null;
      password_salt: string | null;
    }>();

  if (!row?.password_hash || !row.password_salt) {
    return json({ error: "invalid_credentials" }, 401);
  }

  const ok = await verifyPassword(password, row.password_salt, row.password_hash);
  if (!ok) return json({ error: "invalid_credentials" }, 401);

  const token = await createAuthSession(context.env, row.id);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
    "Set-Cookie": sessionCookieHeader(token, 30 * 86400),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      user: {
        id: row.id,
        email: row.email,
        display_name: row.display_name,
        plan_code: row.plan_code || "free",
      },
    }),
    { headers },
  );
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
