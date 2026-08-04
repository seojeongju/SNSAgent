import { corsHeaders, json, type Env } from "../_shared";
import {
  getSystemPrompt,
  getUserPrompt,
  stripJsonFence,
  type ContentType,
  type Platform,
} from "../_content";
import { ensureUser, getQuota, incrementUsage } from "../_billing";

const ALLOWED_PLATFORMS = new Set<Platform>([
  "instagram_reels",
  "youtube_shorts",
  "tiktok",
  "facebook",
  "all",
]);

/**
 * POST /api/generate
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestId = crypto.randomUUID();

  if (!context.env.OPENAI_API_KEY) {
    return json(
      {
        error:
          "OPENAI_API_KEY is not set. Add it in Pages → Settings → Variables and secrets.",
        request_id: requestId,
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

  const userId = (body.user_id ?? "user_demo").trim() || "user_demo";
  const platform = (body.platform ?? "").trim() as Platform;
  const contentType = (body.content_type ?? "bundle").trim() as ContentType;
  const topic = (body.topic ?? "").trim();
  const tone = body.tone?.trim() || null;

  if (!topic) return json({ error: "topic required", request_id: requestId }, 400);
  if (!ALLOWED_PLATFORMS.has(platform)) {
    return json(
      {
        error:
          "platform must be one of: instagram_reels, youtube_shorts, tiktok, facebook, all",
        request_id: requestId,
      },
      400,
    );
  }
  if (!["script", "caption", "bundle"].includes(contentType)) {
    return json(
      { error: "content_type must be script | caption | bundle", request_id: requestId },
      400,
    );
  }

  await ensureUser(context.env, userId);
  const quota = await getQuota(context.env, userId);
  if (!quota.allowed) {
    return json(
      {
        error: "monthly_quota_exceeded",
        message: "이번 달 Free 생성 한도를 모두 사용했습니다. Pro로 업그레이드하세요.",
        quota,
        request_id: requestId,
        upgrade_hint: true,
      },
      402,
    );
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
    return json(
      { error: "OpenAI request failed", details: errText, request_id: requestId },
      502,
    );
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
    return json(
      { error: "Failed to parse model JSON", raw, request_id: requestId },
      502,
    );
  }

  const generationId = crypto.randomUUID();
  const r2Key = `scripts/${userId}/${generationId}.json`;
  const resultText = JSON.stringify(parsed);

  try {
    await context.env.MEDIA.put(r2Key, resultText, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        user_id: userId,
        platform,
        content_type: contentType,
      },
    });

    await context.env.DB.prepare(
      `INSERT INTO generations
        (id, user_id, platform, content_type, topic, tone, result_json, r2_key, openai_usage_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        generationId,
        userId,
        platform,
        contentType,
        topic,
        tone,
        resultText,
        r2Key,
        JSON.stringify(openaiJson.usage ?? null),
      )
      .run();

    await context.env.DB.prepare(
      `INSERT INTO artifacts (id, user_id, kind, r2_key, content_type, size_bytes, metadata_json)
       VALUES (?, ?, 'script', ?, 'application/json', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        r2Key,
        resultText.length,
        JSON.stringify({ generation_id: generationId, platform, content_type: contentType }),
      )
      .run();

    await incrementUsage(context.env, userId);

    await context.env.DB.prepare(
      `INSERT INTO chat_messages (id, user_id, sender, receiver, content, content_format, metadata_json)
       VALUES (?, ?, 'AGENT', 'USER', ?, 'json', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        resultText,
        JSON.stringify({ generation_id: generationId, platform }),
      )
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json(
      {
        error: "persist_failed",
        message,
        result: parsed,
        request_id: requestId,
        hint: "D1 migration 0002 may be missing. Run: wrangler d1 migrations apply snsagent-db --remote",
      },
      500,
    );
  }

  const quotaAfter = await getQuota(context.env, userId);

  return json({
    status: "ok",
    request_id: requestId,
    generation_id: generationId,
    platform,
    content_type: contentType,
    language: "ko",
    result: parsed,
    r2_key: r2Key,
    usage: openaiJson.usage ?? null,
    quota: quotaAfter,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
