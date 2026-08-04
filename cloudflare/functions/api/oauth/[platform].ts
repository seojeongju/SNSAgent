/**
 * GET /api/oauth/:platform?user_id=
 * Starts OAuth for meta (instagram/facebook), google (youtube), tiktok.
 */
import { appBase, corsHeaders, json, type Env } from "../../_shared";

type PlatformParam = "instagram" | "facebook" | "youtube" | "tiktok" | "meta";

function mapPlatform(p: string): "instagram_reels" | "facebook" | "youtube_shorts" | "tiktok" | null {
  if (p === "instagram" || p === "instagram_reels") return "instagram_reels";
  if (p === "facebook" || p === "meta") return "facebook";
  if (p === "youtube" || p === "youtube_shorts") return "youtube_shorts";
  if (p === "tiktok") return "tiktok";
  return null;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const platformParam = (context.params.platform as string || "").toLowerCase() as PlatformParam;
  const mapped = mapPlatform(platformParam);
  const url = new URL(context.request.url);
  const userId = url.searchParams.get("user_id");
  if (!userId) return json({ error: "user_id required" }, 400);
  if (!mapped) {
    return json({ error: "platform must be instagram | facebook | youtube | tiktok" }, 400);
  }

  const base = appBase(context.request, context.env);
  const redirectUri =
    context.env.META_REDIRECT_URI ||
    context.env.GOOGLE_REDIRECT_URI ||
    context.env.TIKTOK_REDIRECT_URI ||
    `${base}/api/oauth/callback`;

  const state = btoa(
    JSON.stringify({
      user_id: userId,
      platform: mapped,
      nonce: crypto.randomUUID(),
    }),
  );

  if (mapped === "instagram_reels" || mapped === "facebook") {
    if (!context.env.META_APP_ID) {
      return json(
        {
          error: "meta_not_configured",
          message:
            "META_APP_ID / META_APP_SECRET 를 Pages Secrets에 설정하세요. 또는 /api/accounts 로 토큰을 직접 등록할 수 있습니다.",
          manual_connect: true,
        },
        400,
      );
    }
    const auth = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    auth.searchParams.set("client_id", context.env.META_APP_ID);
    auth.searchParams.set("redirect_uri", context.env.META_REDIRECT_URI || redirectUri);
    auth.searchParams.set("state", state);
    auth.searchParams.set(
      "scope",
      [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
        "instagram_basic",
        "instagram_content_publish",
        "business_management",
      ].join(","),
    );
    return Response.redirect(auth.toString(), 302);
  }

  if (mapped === "youtube_shorts") {
    if (!context.env.GOOGLE_CLIENT_ID) {
      return json(
        {
          error: "google_not_configured",
          message: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET 를 설정하세요.",
          manual_connect: true,
        },
        400,
      );
    }
    const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    auth.searchParams.set("client_id", context.env.GOOGLE_CLIENT_ID);
    auth.searchParams.set("redirect_uri", context.env.GOOGLE_REDIRECT_URI || redirectUri);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("access_type", "offline");
    auth.searchParams.set("prompt", "consent");
    auth.searchParams.set("state", state);
    auth.searchParams.set(
      "scope",
      [
        "https://www.googleapis.com/auth/youtube.upload",
        "https://www.googleapis.com/auth/youtube.readonly",
      ].join(" "),
    );
    return Response.redirect(auth.toString(), 302);
  }

  // tiktok
  if (!context.env.TIKTOK_CLIENT_KEY) {
    return json(
      {
        error: "tiktok_not_configured",
        message: "TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET 를 설정하세요.",
        manual_connect: true,
      },
      400,
    );
  }
  const auth = new URL("https://www.tiktok.com/v2/auth/authorize/");
  auth.searchParams.set("client_key", context.env.TIKTOK_CLIENT_KEY);
  auth.searchParams.set("redirect_uri", context.env.TIKTOK_REDIRECT_URI || redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "user.info.basic,video.publish,video.upload");
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
};

export const onRequestOptions: PagesFunction = async () =>
  new Response(null, { headers: corsHeaders });
