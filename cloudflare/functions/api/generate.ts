import { corsHeaders, json, type Env } from "../_shared";
import {
  getSystemPrompt,
  getUserPrompt,
  stripJsonFence,
  type ContentType,
  type Platform,
} from "../_content";

const ALLOWED_PLATFORMS = new Set<Platform>([
  "instagram_reels",
  "youtube_shorts",
  "tiktok",
  "facebook",
  "all",
]);

/**
 * POST /api/generate
 * { platform, content_type, topic, tone?, target_audience?, duration_sec?, brand_or_product?, extra_notes?, user_id? }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!context.env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "OPENAI_API_KEY is not set. Add it in Pages → Settings → Variables and secrets.",
      },
      500,
    );
  }

  const body = (await context.request.json()) as {
    platform?: string;
    content_type?: string;
    topic?: string;
    tone?: string;
    target_audience?: string;
    duration_sec?: number;
    brand_or_product?: string;
    extra_notes?: string;
    user_id?: string;
  };

  const platform = (body.platform ?? "").trim() as Platform;
  const contentType = (body.content_type ?? "bundle").trim() as ContentType;
  const topic = (body.topic ?? "").trim();

  if (!topic) return json({ error: "topic required" }, 400);
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return json(
      {
        error:
          "platform must be one of: instagram_reels, youtube_shorts, tiktok, facebook, all",
      },
      400,
    );
  }
  if (!["script", "caption", "bundle"].includes(contentType)) {
    return json({ error: "content_type must be script | caption | bundle" }, 400);
  }

  const system = getSystemPrompt(
    platform === "all" ? "all" : platform,
    platform === "all" ? "bundle" : contentType,
  );
  const user = getUserPrompt({
    platform,
    contentType: platform === "all" ? "bundle" : contentType,
    topic,
    tone: body.tone,
    targetAudience: body.target_audience,
    durationSec: body.duration_sec,
    brandOrProduct: body.brand_or_product,
    extraNotes: body.extra_notes,
  });

  const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${context.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    return json({ error: "OpenAI request failed", details: errText }, 502);
  }

  const openaiJson = (await openaiRes.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: unknown;
  };
  const raw = openaiJson.choices?.[0]?.message?.content ?? "{}";
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(raw));
  } catch {
    return json({ error: "Failed to parse model JSON", raw }, 502);
  }

  // Best-effort persist
  try {
    const userId = body.user_id ?? "user_demo";
    await context.env.DB.prepare(`INSERT OR IGNORE INTO users (id) VALUES (?)`)
      .bind(userId)
      .run();
    await context.env.DB.prepare(
      `INSERT INTO chat_messages (id, user_id, sender, receiver, content, content_format)
       VALUES (?, ?, 'AGENT', 'USER', ?, 'json')`,
    )
      .bind(crypto.randomUUID(), userId, JSON.stringify(parsed))
      .run();
  } catch {
    // non-fatal
  }

  return json({
    status: "ok",
    platform,
    content_type: contentType,
    language: "ko",
    result: parsed,
    usage: openaiJson.usage ?? null,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
