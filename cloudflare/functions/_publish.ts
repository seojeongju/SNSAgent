/**
 * Platform publish adapters for SNSAgent.
 * - Instagram Reels / Facebook: Meta Graph API (video URL pull)
 * - YouTube Shorts / TikTok: token-aware stubs + manual_ready package
 */
import type { Env } from "./_shared";

export type PublishPlatform =
  | "instagram_reels"
  | "youtube_shorts"
  | "tiktok"
  | "facebook";

export type AccountRow = {
  id: string;
  user_id: string;
  platform: string;
  account_id: string | null;
  account_name: string | null;
  access_token: string | null;
  refresh_token: string | null;
  metadata_json: string | null;
  status: string;
};

export type PublishInput = {
  platform: PublishPlatform;
  caption: string;
  title?: string;
  mediaUrl: string;
  account?: AccountRow | null;
  env: Env;
};

export type PublishResult = {
  status: "published" | "manual_ready" | "failed";
  external_post_id?: string;
  external_url?: string;
  error_message?: string;
  result?: unknown;
  manual_package?: {
    platform: string;
    title?: string;
    caption: string;
    media_url: string;
    instructions: string[];
  };
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function metaCreateAndPublish(opts: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
  mediaType?: "REELS" | "VIDEO";
}): Promise<PublishResult> {
  const { igUserId, accessToken, videoUrl, caption } = opts;
  const mediaType = opts.mediaType ?? "REELS";

  const createUrl = new URL(`https://graph.facebook.com/v21.0/${igUserId}/media`);
  createUrl.searchParams.set("media_type", mediaType);
  createUrl.searchParams.set("video_url", videoUrl);
  createUrl.searchParams.set("caption", caption);
  createUrl.searchParams.set("share_to_feed", "true");
  createUrl.searchParams.set("access_token", accessToken);

  const createRes = await fetch(createUrl.toString(), { method: "POST" });
  const createJson = (await createRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!createRes.ok || !createJson.id) {
    return {
      status: "failed",
      error_message: createJson.error?.message || "Meta media create failed",
      result: createJson,
    };
  }

  const containerId = createJson.id;

  // Poll until FINISHED (max ~2 min)
  let status = "IN_PROGRESS";
  for (let i = 0; i < 24; i++) {
    await sleep(5000);
    const stUrl = new URL(`https://graph.facebook.com/v21.0/${containerId}`);
    stUrl.searchParams.set("fields", "status_code,status");
    stUrl.searchParams.set("access_token", accessToken);
    const stRes = await fetch(stUrl.toString());
    const stJson = (await stRes.json()) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };
    status = stJson.status_code || stJson.status || "IN_PROGRESS";
    if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") break;
  }

  if (status !== "FINISHED") {
    return {
      status: "failed",
      error_message: `Meta container not ready: ${status}`,
      result: { containerId, status },
    };
  }

  const pubUrl = new URL(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`);
  pubUrl.searchParams.set("creation_id", containerId);
  pubUrl.searchParams.set("access_token", accessToken);
  const pubRes = await fetch(pubUrl.toString(), { method: "POST" });
  const pubJson = (await pubRes.json()) as {
    id?: string;
    error?: { message?: string };
  };
  if (!pubRes.ok || !pubJson.id) {
    return {
      status: "failed",
      error_message: pubJson.error?.message || "Meta publish failed",
      result: pubJson,
    };
  }

  return {
    status: "published",
    external_post_id: pubJson.id,
    external_url: `https://www.instagram.com/reel/${pubJson.id}/`,
    result: pubJson,
  };
}

async function facebookPageVideoPublish(opts: {
  pageId: string;
  accessToken: string;
  videoUrl: string;
  description: string;
  title?: string;
}): Promise<PublishResult> {
  const body = new URLSearchParams({
    file_url: opts.videoUrl,
    description: opts.description,
    access_token: opts.accessToken,
  });
  if (opts.title) body.set("title", opts.title);

  const res = await fetch(`https://graph.facebook.com/v21.0/${opts.pageId}/videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    return {
      status: "failed",
      error_message: data.error?.message || "Facebook video publish failed",
      result: data,
    };
  }
  return {
    status: "published",
    external_post_id: data.id,
    external_url: `https://www.facebook.com/${data.id}`,
    result: data,
  };
}

function manualPackage(
  platform: PublishPlatform,
  caption: string,
  mediaUrl: string,
  title?: string,
): PublishResult {
  const instructions: Record<PublishPlatform, string[]> = {
    instagram_reels: [
      "Instagram 앱/웹에서 릴스 업로드를 엽니다.",
      "영상 파일을 올리고 아래 캡션을 붙여넣습니다.",
      "Meta 비즈니스 연동이 되면 원클릭 자동 게시가 활성화됩니다.",
    ],
    facebook: [
      "Facebook 페이지 또는 릴스 업로드로 이동합니다.",
      "영상을 올리고 캡션을 붙여넣습니다.",
      "페이지 토큰이 연결되면 자동 게시를 사용할 수 있습니다.",
    ],
    youtube_shorts: [
      "YouTube Studio > 만들기 > 동영상 업로드로 이동합니다.",
      "세로 영상을 올리고 #Shorts 가 포함된 제목/설명을 사용합니다.",
      "Google OAuth 연동 후 자동 업로드를 지원합니다.",
    ],
    tiktok: [
      "틱톡 앱에서 업로드를 엽니다.",
      "영상과 캡션/해시태그를 붙여넣습니다.",
      "TikTok Content Posting API 연동 후 자동 게시가 가능합니다.",
    ],
  };

  return {
    status: "manual_ready",
    manual_package: {
      platform,
      title,
      caption,
      media_url: mediaUrl,
      instructions: instructions[platform],
    },
  };
}

export async function publishToPlatform(input: PublishInput): Promise<PublishResult> {
  const { platform, caption, title, mediaUrl, account, env } = input;

  if (platform === "instagram_reels") {
    const token = account?.access_token || env.META_ACCESS_TOKEN;
    const igUserId =
      account?.account_id ||
      (account?.metadata_json
        ? (JSON.parse(account.metadata_json) as { ig_user_id?: string }).ig_user_id
        : undefined) ||
      env.META_IG_USER_ID;

    if (token && igUserId) {
      return metaCreateAndPublish({
        igUserId,
        accessToken: token,
        videoUrl: mediaUrl,
        caption,
        mediaType: "REELS",
      });
    }
    return manualPackage(platform, caption, mediaUrl, title);
  }

  if (platform === "facebook") {
    const token = account?.access_token || env.META_ACCESS_TOKEN;
    const pageId =
      account?.account_id ||
      (account?.metadata_json
        ? (JSON.parse(account.metadata_json) as { page_id?: string }).page_id
        : undefined) ||
      env.META_PAGE_ID;

    if (token && pageId) {
      return facebookPageVideoPublish({
        pageId,
        accessToken: token,
        videoUrl: mediaUrl,
        description: caption,
        title,
      });
    }
    return manualPackage(platform, caption, mediaUrl, title);
  }

  // YouTube / TikTok — auto-publish requires OAuth tokens; return guided package for now
  // (structure ready: when access_token present, extend adapters)
  if (
    (platform === "youtube_shorts" || platform === "tiktok") &&
    account?.access_token
  ) {
    return {
      status: "manual_ready",
      error_message:
        "계정은 연결됐지만 자동 업로드 어댑터 활성화 전입니다. 패키지로 게시해 주세요.",
      manual_package: manualPackage(platform, caption, mediaUrl, title).manual_package,
    };
  }

  return manualPackage(platform, caption, mediaUrl, title);
}

export function extractCaptionFromGeneration(
  platform: PublishPlatform,
  result: unknown,
): { caption: string; title?: string } {
  const r = result as Record<string, unknown>;

  const fromCaptionObj = (c: unknown) => {
    if (!c || typeof c !== "object") return { caption: "", title: undefined as string | undefined };
    const obj = c as Record<string, unknown>;
    const caption = String(obj.caption || obj.description || "");
    const titles = obj.titles as string[] | undefined;
    const titleIdeas = obj.title_ideas as string[] | undefined;
    const title = titles?.[0] || titleIdeas?.[0] || String(obj.first_line_hook || "");
    const hashtags = Array.isArray(obj.hashtags) ? (obj.hashtags as string[]).join(" ") : "";
    return {
      caption: [caption, hashtags].filter(Boolean).join("\n\n"),
      title: title || undefined,
    };
  };

  if (platform !== "instagram_reels" && platform !== "facebook" && platform !== "youtube_shorts" && platform !== "tiktok") {
    return { caption: "" };
  }

  // all-platform bundle
  const pack = r[platform] as { caption?: unknown; script?: unknown } | undefined;
  if (pack?.caption) return fromCaptionObj(pack.caption);

  // single caption/script object
  if (r.caption || r.description || r.hashtags) return fromCaptionObj(r);

  // script only fallback
  if (typeof r.full_script === "string") {
    return { caption: r.full_script, title: (r.title_ideas as string[] | undefined)?.[0] };
  }

  return { caption: JSON.stringify(r).slice(0, 2000) };
}
