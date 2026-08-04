/**
 * POST /api/billing/checkout
 * Creates Stripe Checkout Session for Pro upgrade.
 * Body: { user_id? } — prefers cookie session
 */
import { appBase, corsHeaders, json, type Env } from "../../_shared";
import { resolveUserId } from "../../_auth";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.STRIPE_SECRET_KEY || !context.env.STRIPE_PRICE_PRO) {
    return json(
      {
        error: "stripe_not_configured",
        message:
          "STRIPE_SECRET_KEY / STRIPE_PRICE_PRO 를 Pages Secrets에 설정하세요.",
      },
      400,
    );
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

  if (!auth) {
    return json(
      { error: "login_required", message: "구독은 로그인 후 이용할 수 있습니다." },
      401,
    );
  }

  const base = appBase(context.request, context.env);

  // Reuse existing Stripe customer if present
  const sub = await context.env.DB.prepare(
    `SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ stripe_customer_id: string | null }>();

  const payload: Record<string, string> = {
    mode: "subscription",
    success_url: `${base}/#billing?checkout=success`,
    cancel_url: `${base}/#billing?checkout=cancel`,
    client_reference_id: userId,
    "line_items[0][price]": context.env.STRIPE_PRICE_PRO,
    "line_items[0][quantity]": "1",
    "subscription_data[metadata][user_id]": userId,
    "metadata[user_id]": userId,
  };
  if (auth.email) payload.customer_email = auth.email;
  if (sub?.stripe_customer_id) {
    payload.customer = sub.stripe_customer_id;
    delete payload.customer_email;
  }

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(payload),
  });
  const data = (await res.json()) as { id?: string; url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    return json(
      { error: "stripe_checkout_failed", message: data.error?.message || "checkout failed" },
      502,
    );
  }

  return json({ checkout_url: data.url, session_id: data.id });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
