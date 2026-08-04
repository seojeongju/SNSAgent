import { corsHeaders, json, type Env } from "../_shared";

/**
 * GET  /api/health
 */
export const onRequestGet: PagesFunction<Env> = async () => {
  return json({
    status: "ok",
    service: "SNSAgent",
    platform: "Cloudflare Pages",
    storage: { d1: "DB", r2: "MEDIA" },
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
