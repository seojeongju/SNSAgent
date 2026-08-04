import { corsHeaders, json, type Env } from "../../_shared";

/**
 * GET /api/assets/[[path]]
 * Example: /api/assets/uploads/user1/default/file.txt
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const pathParam = context.params.path;
  const key = Array.isArray(pathParam) ? pathParam.join("/") : pathParam;

  if (!key) return json({ error: "asset path required" }, 400);

  const object = await context.env.MEDIA.get(key);
  if (!object) return json({ error: "not found" }, 404);

  const headers = new Headers(corsHeaders);
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
