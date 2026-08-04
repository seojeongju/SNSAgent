/**
 * Shared Env / helpers for SNSAgent Pages Functions
 */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  TIKHUB_API_KEY?: string;
  /** Meta Graph (Instagram / Facebook) */
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_REDIRECT_URI?: string;
  /** Optional service-level tokens for quick setup (dev) */
  META_ACCESS_TOKEN?: string;
  META_IG_USER_ID?: string;
  META_PAGE_ID?: string;
  /** Google / YouTube */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  /** TikTok */
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  TIKTOK_REDIRECT_URI?: string;
  APP_BASE_URL?: string;
  /** Stripe */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PRO?: string;
}

export const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

export function appBase(request: Request, env: Env): string {
  return (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
