/**
 * POST /api/auth/signup
 * { email, password, display_name? }
 */
import { corsHeaders, json, type Env } from "../../_shared";
import {
  createAuthSession,
  hashPassword,
  sessionCookieHeader,
} from "../../_auth";
import { ensureUser } from "../../_billing";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    email?: string;
    password?: string;
    display_name?: string;
  };

  const email = (body.email || "").trim().toLowerCase();
  const password = body.password || "";
  const displayName = (body.display_name || "").trim() || email.split("@")[0];

  if (!email || !email.includes("@")) {
    return json({ error: "valid_email_required" }, 400);
  }
  if (password.length < 8) {
    return json({ error: "password_min_8" }, 400);
  }

  const existing = await context.env.DB.prepare(
    `SELECT id FROM users WHERE email = ?`,
  )
    .bind(email)
    .first();
  if (existing) return json({ error: "email_already_registered" }, 409);

  const userId = "user_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  const { hash, salt } = await hashPassword(password);

  await context.env.DB.prepare(
    `INSERT INTO users (id, email, display_name, plan_code, password_hash, password_salt)
     VALUES (?, ?, ?, 'free', ?, ?)`,
  )
    .bind(userId, email, displayName, hash, salt)
    .run();

  await ensureUser(context.env, userId);

  const token = await createAuthSession(context.env, userId);
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders,
    "Set-Cookie": sessionCookieHeader(token, 30 * 86400),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id: userId, email, display_name: displayName, plan_code: "free" },
    }),
    { status: 201, headers },
  );
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
