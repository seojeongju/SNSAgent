/**
 * POST /api/billing/portal
 * Stripe Customer Portal session
 */
import { appBase, corsHeaders, json, type Env } from "../../_shared";
import { resolveUserId } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.STRIPE_SECRET_KEY) {
    return json({ error: "stripe_not_configured" }, 400);
  }

  let body: { user_id?: string } = {};
  try {
    body = (await context.request.json()) as { user_id?: string };
  } catch {
    /* empty */
  }

  const { userId, auth } = await resolveUserId(
    context.env,
    context.request,
    body.user_id,
  );
  if (!auth) return json({ error: "login_required" }, 401);

  const sub = await context.env.DB.prepare(
    `SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  if (!sub?.stripe_customer_id) {
    return json(
      { error: "no_stripe_customer", message: "먼저 Pro 구독을 시작하세요." },
      400,
    );
  }

  const base = appBase(context.request, context.env);
  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      customer: sub.stripe_customer_id,
      return_url: `${base}/#billing`,
    }),
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    return json(
      { error: "portal_failed", message: data.error?.message || "portal failed" },
      502,
    );
  }
  return json({ portal_url: data.url });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
