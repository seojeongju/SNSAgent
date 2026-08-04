import { corsHeaders, json, type Env } from "../_shared";

/**
 * GET  /api/chat?user_id=&limit=
 * POST /api/chat  { user_id, session_id?, sender?, content, content_format? }
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);

  const limit = Number(url.searchParams.get("limit") ?? "50");
  const { results } = await context.env.DB.prepare(
    `SELECT id, sender, receiver, content, content_format, metadata_json, created_at
     FROM chat_messages
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all();

  return json({ user_id: userId, messages: results });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const body = (await context.request.json()) as {
    user_id: string;
    session_id?: string;
    sender?: string;
    content: string;
    content_format?: string;
  };

  if (!body.user_id || !body.content) {
    return json({ error: "user_id and content required" }, 400);
  }

  await context.env.DB.prepare(`INSERT OR IGNORE INTO users (id) VALUES (?)`)
    .bind(body.user_id)
    .run();

  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO chat_messages (id, user_id, session_id, sender, receiver, content, content_format)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.user_id,
      body.session_id ?? null,
      body.sender ?? "USER",
      "AGENT",
      body.content,
      body.content_format ?? "text",
    )
    .run();

  // TODO: Pages Function에서 에이전트 오케스트레이션 연결
  return json({
    status: "accepted",
    message_id: id,
    note: "Pages Function stub — agent runtime wiring next.",
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
