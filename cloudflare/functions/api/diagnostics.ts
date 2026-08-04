/**
 * GET /api/diagnostics
 * Public readiness flags (never returns secret values).
 */
import { corsHeaders, json, type Env } from "../_shared";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const env = context.env;
  return json({
    openai: Boolean(env.OPENAI_API_KEY),
    meta: {
      oauth: Boolean(env.META_APP_ID && env.META_APP_SECRET),
      service_ig: Boolean(env.META_ACCESS_TOKEN && env.META_IG_USER_ID),
      service_fb: Boolean(env.META_ACCESS_TOKEN && env.META_PAGE_ID),
      redirect_uri: env.META_REDIRECT_URI || null,
    },
    google: {
      oauth: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      redirect_uri: env.GOOGLE_REDIRECT_URI || null,
    },
    tiktok: {
      oauth: Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET),
      redirect_uri: env.TIKTOK_REDIRECT_URI || null,
    },
    stripe: {
      configured: Boolean(env.STRIPE_SECRET_KEY),
      webhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
      price_pro: Boolean(env.STRIPE_PRICE_PRO),
    },
    tips: {
      meta:
        "Pages → Settings → Variables and secrets 에 META_* 를 넣고, Meta 앱 Redirect URI 를 /api/oauth/callback 으로 설정하세요.",
      stripe:
        "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO 를 설정하면 Pro 체크아웃이 활성화됩니다.",
    },
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
