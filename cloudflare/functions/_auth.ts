/**
 * Cookie session auth helpers (PBKDF2 password hashing).
 */
import type { Env } from "./_shared";
import { ensureUser } from "./_billing";

const COOKIE = "snsagent_session";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;

export type AuthUser = {
  id: string;
  email: string | null;
  display_name: string | null;
  plan_code: string;
};

function b64Bytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64(buf: ArrayBuffer): string {
  return b64Bytes(new Uint8Array(buf));
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(password: string, saltB64?: string): Promise<{
  hash: string;
  salt: string;
}> {
  const salt = saltB64 ? fromB64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return { hash: b64(bits), salt: b64Bytes(salt) };
}

export async function verifyPassword(
  password: string,
  salt: string,
  expectedHash: string,
): Promise<boolean> {
  const { hash } = await hashPassword(password, salt);
  return hash === expectedHash;
}

async function hashToken(token: string): Promise<string> {
  const dig = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return b64(dig);
}

function parseCookies(request: Request): Record<string, string> {
  const raw = request.headers.get("Cookie") || "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

export function sessionCookieHeader(token: string, maxAgeSec: number): string {
  const secure = "Secure; ";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${secure}SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function createAuthSession(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, "");
  const tokenHash = await hashToken(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare(
    `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), userId, tokenHash, expires)
    .run();
  return token;
}

export async function destroyAuthSession(env: Env, request: Request): Promise<void> {
  const token = parseCookies(request)[COOKIE];
  if (!token) return;
  const tokenHash = await hashToken(token);
  await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
    .bind(tokenHash)
    .run();
}

export async function getAuthUser(
  env: Env,
  request: Request,
): Promise<AuthUser | null> {
  const token = parseCookies(request)[COOKIE];
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.plan_code, s.expires_at
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?`,
  )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string | null;
      display_name: string | null;
      plan_code: string;
      expires_at: string;
    }>();

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await env.DB.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`)
      .bind(tokenHash)
      .run();
    return null;
  }
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    plan_code: row.plan_code || "free",
  };
}

/**
 * Prefer authenticated session; otherwise guest/local user_id.
 */
export async function resolveUserId(
  env: Env,
  request: Request,
  fallbackUserId?: string | null,
): Promise<{ userId: string; auth: AuthUser | null }> {
  const auth = await getAuthUser(env, request);
  if (auth) {
    await ensureUser(env, auth.id);
    return { userId: auth.id, auth };
  }
  const guest = (fallbackUserId || "user_demo").trim() || "user_demo";
  await ensureUser(env, guest);
  return { userId: guest, auth: null };
}
