/**
 * Quota / plan helpers for SNSAgent (subscription-ready).
 */
import type { Env } from "./_shared";

export type QuotaInfo = {
  user_id: string;
  plan_code: string;
  period: string;
  used: number;
  limit: number;
  remaining: number;
  allowed: boolean;
};

function periodKey(d = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export async function ensureUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, plan_code) VALUES (?, 'free')`,
  )
    .bind(userId)
    .run();

  // Ensure free subscription row exists (best-effort)
  const sub = await env.DB.prepare(
    `SELECT id FROM subscriptions WHERE user_id = ?`,
  )
    .bind(userId)
    .first();

  if (!sub) {
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, plan_id, status)
       VALUES (?, ?, 'plan_free', 'active')`,
    )
      .bind(crypto.randomUUID(), userId)
      .run();
  }
}

export async function getQuota(env: Env, userId: string): Promise<QuotaInfo> {
  await ensureUser(env, userId);
  const period = periodKey();

  const user = await env.DB.prepare(
    `SELECT plan_code FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<{ plan_code: string }>();

  const planCode = user?.plan_code || "free";
  const plan = await env.DB.prepare(
    `SELECT generations_per_month FROM plans WHERE code = ?`,
  )
    .bind(planCode)
    .first<{ generations_per_month: number }>();

  const limit = plan?.generations_per_month ?? 20;

  const counter = await env.DB.prepare(
    `SELECT generations_used FROM usage_counters WHERE user_id = ? AND period = ?`,
  )
    .bind(userId, period)
    .first<{ generations_used: number }>();

  const used = counter?.generations_used ?? 0;
  const remaining = Math.max(0, limit - used);

  return {
    user_id: userId,
    plan_code: planCode,
    period,
    used,
    limit,
    remaining,
    allowed: used < limit,
  };
}

export async function incrementUsage(env: Env, userId: string): Promise<void> {
  const period = periodKey();
  await env.DB.prepare(
    `INSERT INTO usage_counters (user_id, period, generations_used, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id, period) DO UPDATE SET
       generations_used = generations_used + 1,
       updated_at = datetime('now')`,
  )
    .bind(userId, period)
    .run();
}
