/**
 * Shared Env / helpers for SNSAgent Pages Functions
 */
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  OPENAI_API_KEY?: string;
  TIKHUB_API_KEY?: string;
}

export const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
