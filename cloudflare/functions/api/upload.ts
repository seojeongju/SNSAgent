import { corsHeaders, json, type Env } from "../_shared";

/**
 * POST /api/upload?user_id=&session_id=&filename=
 * Body: raw file bytes
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id") ?? "anonymous";
  const sessionId = url.searchParams.get("session_id") ?? "default";
  const filename = url.searchParams.get("filename") ?? `file-${Date.now()}`;
  const contentType =
    context.request.headers.get("Content-Type") ?? "application/octet-stream";
  const bytes = await context.request.arrayBuffer();

  const key = `uploads/${userId}/${sessionId}/${filename}`;
  await context.env.ASSETS.put(key, bytes, {
    httpMetadata: { contentType },
  });

  await context.env.DB.prepare(`INSERT OR IGNORE INTO users (id) VALUES (?)`)
    .bind(userId)
    .run();

  const artifactId = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO artifacts (id, user_id, session_id, kind, r2_key, content_type, size_bytes)
     VALUES (?, ?, ?, 'upload', ?, ?, ?)`,
  )
    .bind(artifactId, userId, sessionId, key, contentType, bytes.byteLength)
    .run();

  return json({
    artifact_id: artifactId,
    r2_key: key,
    size_bytes: bytes.byteLength,
  });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
