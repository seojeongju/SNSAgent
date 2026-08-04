/**
 * POST /api/billing/webhook
 * Stripe webhooks → update D1 subscriptions / plan_code
 */
import { json, type Env } from "../../_shared";

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseStripeSignature(header: string | null): { t: string; v1: string } | null {
  if (!header) return null;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const [k, v] = p.split("=");
      return [k.trim(), v];
    }),
  );
  if (!parts.t || !parts.v1) return null;
  return { t: parts.t, v1: parts.v1 };
}

async function setPlan(
  env: Env,
  userId: string,
  planCode: "free" | "pro" | "business",
  opts: {
    status: string;
    stripe_customer_id?: string | null;
    stripe_subscription_id?: string | null;
    current_period_end?: string | null;
  },
) {
  const plan = await env.DB.prepare(`SELECT id FROM plans WHERE code = ?`)
    .bind(planCode)
    .first<{ id: string }>();
  if (!plan) return;

  await env.DB.prepare(`UPDATE users SET plan_code = ? WHERE id = ?`)
    .bind(planCode, userId)
    .run();

  await env.DB.prepare(
    `INSERT INTO subscriptions (id, user_id, plan_id, status, stripe_customer_id, stripe_subscription_id, current_period_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       plan_id = excluded.plan_id,
       status = excluded.status,
       stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       updated_at = datetime('now')`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      plan.id,
      opts.status,
      opts.stripe_customer_id || null,
      opts.stripe_subscription_id || null,
      opts.current_period_end || null,
    )
    .run();
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const secret = context.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return json({ error: "webhook_secret_missing" }, 500);

  const raw = await context.request.text();
  const sigHeader = context.request.headers.get("stripe-signature");
  const parsed = parseStripeSignature(sigHeader);
  if (!parsed) return json({ error: "invalid_signature_header" }, 400);

  const signed = `${parsed.t}.${raw}`;
  const expected = await hmacSha256Hex(secret, signed);
  // Stripe may send multiple v1; we compare the first matched from header
  const v1s = (sigHeader || "")
    .split(",")
    .filter((p) => p.trim().startsWith("v1="))
    .map((p) => p.trim().slice(3));
  if (!v1s.includes(expected)) {
    // timing-safe-ish compare via includes is ok for list; reject if none match
    return json({ error: "signature_mismatch" }, 400);
  }

  const event = JSON.parse(raw) as {
    type: string;
    data: { object: Record<string, unknown> };
  };

  try {
    if (event.type === "checkout.session.completed") {
      const obj = event.data.object;
      const userId =
        (obj.client_reference_id as string) ||
        ((obj.metadata as Record<string, string> | undefined)?.user_id);
      if (userId) {
        await setPlan(context.env, userId, "pro", {
          status: "active",
          stripe_customer_id: (obj.customer as string) || null,
          stripe_subscription_id: (obj.subscription as string) || null,
        });
      }
    }

    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const obj = event.data.object;
      const meta = obj.metadata as Record<string, string> | undefined;
      let userId = meta?.user_id;
      const customerId = obj.customer as string | undefined;

      if (!userId && customerId) {
        const row = await context.env.DB.prepare(
          `SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?`,
        )
          .bind(customerId)
          .first<{ user_id: string }>();
        userId = row?.user_id;
      }

      if (userId) {
        const status = String(obj.status || "canceled");
        const active = status === "active" || status === "trialing";
        const periodEnd = obj.current_period_end
          ? new Date(Number(obj.current_period_end) * 1000).toISOString()
          : null;
        await setPlan(context.env, userId, active ? "pro" : "free", {
          status: active ? status : "canceled",
          stripe_customer_id: customerId || null,
          stripe_subscription_id: (obj.id as string) || null,
          current_period_end: periodEnd,
        });
      }
    }
  } catch (e) {
    return json({ error: "handler_failed", message: String(e) }, 500);
  }

  return json({ received: true });
};
