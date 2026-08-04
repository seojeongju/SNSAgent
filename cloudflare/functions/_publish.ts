/**
 * Platform publish adapters for SNSAgent.
 * Instagram/Facebook: Meta Graph
 * YouTube Shorts: Data API v3 resumable upload
 * TikTok: Content Posting API (PULL_FROM_URL or FILE_UPLOAD)
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

export type TokenUpdate = {
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
};

export type PublishResult = {
  status: "published" | "manual_ready" | "failed";
  external_post_id?: string;
  external_url?: string;
  error_message?: string;
  result?: unknown;
  token_update?: TokenUpdate;
  manual_package?: {
    platform: string;
    title?: string;
    caption: string;
    media_url: string;
    instructions: string[];
  };
};

const MAX_VIDEO_BYTES = 40 * 1024 * 1024; // Workers-friendly limit

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchVideoBytes(mediaUrl: string): Promise<
  | { ok: true; bytes: ArrayBuffer; contentType: string; size: number }
  | { ok: false; error: string }
> {
  const res = await fetch(mediaUrl);
  if (!res.ok) {
    return { ok: false, error: `영상 URL fetch 실패 (${res.status})` };
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `영상이 너무 큽니다 (${Math.round(len / 1024 / 1024)}MB). ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB 이하로 올려 주세요.`,
    };
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    return {
      ok: false,
      error: `영상이 너무 큽니다 (${Math.round(bytes.byteLength / 1024 / 1024)}MB). ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB 이하로 올려 주세요.`,
    };
  }
  const contentType = res.headers.get("content-type") || "video/mp4";
  return { ok: true, bytes, contentType, size: bytes.byteLength };
}

// —— Meta ——

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

// —— YouTube ——

async function refreshGoogleAccessToken(
  env: Env,
  refreshToken: string,
): Promise<TokenUpdate | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null;
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    token_expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  };
}

function shortsTitle(title: string | undefined, caption: string): string {
  const base = (title || caption.split("\n")[0] || "Shorts").trim().slice(0, 90);
  return /#shorts/i.test(base) ? base : `${base} #Shorts`.slice(0, 100);
}

async function youtubeShortsPublish(opts: {
  env: Env;
  account: AccountRow;
  mediaUrl: string;
  caption: string;
  title?: string;
}): Promise<PublishResult> {
  let accessToken = opts.account.access_token;
  let tokenUpdate: TokenUpdate | undefined;

  if (!accessToken && opts.account.refresh_token) {
    const refreshed = await refreshGoogleAccessToken(opts.env, opts.account.refresh_token);
    if (refreshed) {
      accessToken = refreshed.access_token;
      tokenUpdate = refreshed;
    }
  }

  if (!accessToken) {
    return manualPackage("youtube_shorts", opts.caption, opts.mediaUrl, opts.title);
  }

  // Attempt once; on 401 refresh and retry
  const attempt = async (token: string) => {
    const video = await fetchVideoBytes(opts.mediaUrl);
    if (!video.ok) {
      return { status: "failed" as const, error_message: video.error };
    }

    const meta = {
      snippet: {
        title: shortsTitle(opts.title, opts.caption),
        description: opts.caption.slice(0, 4900),
        categoryId: "22",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    };

    const initRes = await fetch(
      "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(video.size),
          "X-Upload-Content-Type": video.contentType,
        },
        body: JSON.stringify(meta),
      },
    );

    if (initRes.status === 401) {
      return { status: "unauthorized" as const };
    }

    const uploadUrl = initRes.headers.get("location");
    if (!initRes.ok || !uploadUrl) {
      const err = (await initRes.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      return {
        status: "failed" as const,
        error_message: err.error?.message || `YouTube init failed (${initRes.status})`,
        result: err,
      };
    }

    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": video.contentType,
        "Content-Length": String(video.size),
      },
      body: video.bytes,
    });
    const putJson = (await putRes.json()) as {
      id?: string;
      error?: { message?: string };
    };
    if (!putRes.ok || !putJson.id) {
      return {
        status: "failed" as const,
        error_message: putJson.error?.message || `YouTube upload failed (${putRes.status})`,
        result: putJson,
      };
    }

    return {
      status: "published" as const,
      external_post_id: putJson.id,
      external_url: `https://youtube.com/shorts/${putJson.id}`,
      result: putJson,
    };
  };

  let first = await attempt(accessToken);
  if (first.status === "unauthorized" && opts.account.refresh_token) {
    const refreshed = await refreshGoogleAccessToken(opts.env, opts.account.refresh_token);
    if (refreshed) {
      tokenUpdate = refreshed;
      first = await attempt(refreshed.access_token);
    }
  }

  if (first.status === "unauthorized") {
    return {
      status: "failed",
      error_message: "YouTube 토큰이 만료되었습니다. 계정 탭에서 다시 연결하세요.",
      token_update: tokenUpdate,
    };
  }

  return { ...first, token_update: tokenUpdate };
}

// —— TikTok ——

async function refreshTikTokAccessToken(
  env: Env,
  refreshToken: string,
): Promise<TokenUpdate | null> {
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_CLIENT_SECRET) return null;
  const body = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    client_secret: env.TIKTOK_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!res.ok || !data.access_token) return null;
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token || refreshToken,
    token_expires_at: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null,
  };
}

async function tiktokCreatorPrivacy(
  accessToken: string,
  preferred?: string,
): Promise<string> {
  const res = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/creator_info/query/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: "{}",
    },
  );
  const data = (await res.json()) as {
    data?: { privacy_level_options?: string[] };
    error?: { message?: string; code?: string };
  };
  const options = data.data?.privacy_level_options || [];
  if (preferred && options.includes(preferred)) return preferred;
  if (options.includes("PUBLIC_TO_EVERYONE")) return "PUBLIC_TO_EVERYONE";
  if (options.includes("MUTUAL_FOLLOW_FRIENDS")) return "MUTUAL_FOLLOW_FRIENDS";
  if (options.includes("FOLLOWER_OF_CREATOR")) return "FOLLOWER_OF_CREATOR";
  if (options.includes("SELF_ONLY")) return "SELF_ONLY";
  return preferred || "SELF_ONLY";
}

async function tiktokPollStatus(
  accessToken: string,
  publishId: string,
): Promise<{ status: string; raw: unknown }> {
  let last = "PROCESSING_UPLOAD";
  let raw: unknown = null;
  for (let i = 0; i < 36; i++) {
    await sleep(3000);
    const res = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/status/fetch/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    const data = (await res.json()) as {
      data?: { status?: string; publicaly_available_post_id?: string[] };
      error?: { message?: string };
    };
    raw = data;
    last = data.data?.status || last;
    if (
      last === "PUBLISH_COMPLETE" ||
      last === "FAILED" ||
      last === "SEND_TO_USER_INBOX"
    ) {
      break;
    }
  }
  return { status: last, raw };
}

async function tiktokPublish(opts: {
  env: Env;
  account: AccountRow;
  mediaUrl: string;
  caption: string;
  title?: string;
}): Promise<PublishResult> {
  let accessToken = opts.account.access_token;
  let tokenUpdate: TokenUpdate | undefined;

  if (!accessToken && opts.account.refresh_token) {
    const refreshed = await refreshTikTokAccessToken(opts.env, opts.account.refresh_token);
    if (refreshed) {
      accessToken = refreshed.access_token;
      tokenUpdate = refreshed;
    }
  }
  if (!accessToken) {
    return manualPackage("tiktok", opts.caption, opts.mediaUrl, opts.title);
  }

  const title = (opts.title || opts.caption).slice(0, 2200);
  const preferPull =
    opts.env.TIKTOK_USE_PULL_URL !== "0" && /^https:\/\//i.test(opts.mediaUrl);
  const privacy = await tiktokCreatorPrivacy(
    accessToken,
    opts.env.TIKTOK_PRIVACY_LEVEL,
  );

  // 1) Prefer PULL_FROM_URL (no Worker bandwidth for big files)
  if (preferPull) {
    const initRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          post_info: {
            title,
            privacy_level: privacy,
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
            video_cover_timestamp_ms: 1000,
          },
          source_info: {
            source: "PULL_FROM_URL",
            video_url: opts.mediaUrl,
          },
        }),
      },
    );
    const initJson = (await initRes.json()) as {
      data?: { publish_id?: string };
      error?: { code?: string; message?: string };
    };

    if (initRes.ok && initJson.data?.publish_id) {
      const polled = await tiktokPollStatus(accessToken, initJson.data.publish_id);
      if (polled.status === "PUBLISH_COMPLETE" || polled.status === "SEND_TO_USER_INBOX") {
        const postIds = (polled.raw as { data?: { publicaly_available_post_id?: string[] } })
          ?.data?.publicaly_available_post_id;
        return {
          status: "published",
          external_post_id: postIds?.[0] || initJson.data.publish_id,
          external_url: postIds?.[0]
            ? `https://www.tiktok.com/@/video/${postIds[0]}`
            : undefined,
          result: { init: initJson, status: polled.raw, mode: "PULL_FROM_URL" },
          token_update: tokenUpdate,
        };
      }
      // fall through to FILE_UPLOAD if pull failed processing
      if (polled.status !== "FAILED") {
        return {
          status: "failed",
          error_message: `TikTok 처리 상태: ${polled.status}`,
          result: polled.raw,
          token_update: tokenUpdate,
        };
      }
    }
    // If pull not allowed (domain unverified), continue to FILE_UPLOAD
  }

  // 2) FILE_UPLOAD
  const video = await fetchVideoBytes(opts.mediaUrl);
  if (!video.ok) {
    return { status: "failed", error_message: video.error, token_update: tokenUpdate };
  }

  const chunkSize = video.size;
  const initRes = await fetch(
    "https://open.tiktokapis.com/v2/post/publish/video/init/",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        post_info: {
          title,
          privacy_level: privacy,
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
          video_cover_timestamp_ms: 1000,
        },
        source_info: {
          source: "FILE_UPLOAD",
          video_size: video.size,
          chunk_size: chunkSize,
          total_chunk_count: 1,
        },
      }),
    },
  );
  const initJson = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };

  // Unaudited apps often need inbox flow
  if ((!initRes.ok || !initJson.data?.upload_url) && initJson.error) {
    const inboxRes = await fetch(
      "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({
          source_info: {
            source: "FILE_UPLOAD",
            video_size: video.size,
            chunk_size: chunkSize,
            total_chunk_count: 1,
          },
        }),
      },
    );
    const inboxJson = (await inboxRes.json()) as {
      data?: { publish_id?: string; upload_url?: string };
      error?: { message?: string };
    };
    if (!inboxRes.ok || !inboxJson.data?.upload_url || !inboxJson.data.publish_id) {
      return {
        status: "failed",
        error_message:
          inboxJson.error?.message ||
          initJson.error?.message ||
          "TikTok 업로드 초기화 실패 (앱 권한이 video.publish/video.upload 인지 확인)",
        result: { direct: initJson, inbox: inboxJson },
        token_update: tokenUpdate,
      };
    }

    const putRes = await fetch(inboxJson.data.upload_url, {
      method: "PUT",
      headers: {
        "Content-Type": video.contentType,
        "Content-Length": String(video.size),
        "Content-Range": `bytes 0-${video.size - 1}/${video.size}`,
      },
      body: video.bytes,
    });
    if (!putRes.ok) {
      return {
        status: "failed",
        error_message: `TikTok inbox 업로드 실패 (${putRes.status})`,
        token_update: tokenUpdate,
      };
    }
    const polled = await tiktokPollStatus(accessToken, inboxJson.data.publish_id);
    return {
      status:
        polled.status === "PUBLISH_COMPLETE" || polled.status === "SEND_TO_USER_INBOX"
          ? "published"
          : "failed",
      external_post_id: inboxJson.data.publish_id,
      error_message:
        polled.status === "FAILED" ? "TikTok inbox 처리 실패" : undefined,
      result: { mode: "INBOX_FILE_UPLOAD", status: polled.raw },
      token_update: tokenUpdate,
    };
  }

  if (!initJson.data?.upload_url || !initJson.data.publish_id) {
    return {
      status: "failed",
      error_message: initJson.error?.message || "TikTok init 응답에 upload_url 없음",
      result: initJson,
      token_update: tokenUpdate,
    };
  }

  const putRes = await fetch(initJson.data.upload_url, {
    method: "PUT",
    headers: {
      "Content-Type": video.contentType,
      "Content-Length": String(video.size),
      "Content-Range": `bytes 0-${video.size - 1}/${video.size}`,
    },
    body: video.bytes,
  });
  if (!putRes.ok) {
    return {
      status: "failed",
      error_message: `TikTok 파일 업로드 실패 (${putRes.status})`,
      token_update: tokenUpdate,
    };
  }

  const polled = await tiktokPollStatus(accessToken, initJson.data.publish_id);
  if (polled.status === "PUBLISH_COMPLETE" || polled.status === "SEND_TO_USER_INBOX") {
    const postIds = (polled.raw as { data?: { publicaly_available_post_id?: string[] } })
      ?.data?.publicaly_available_post_id;
    return {
      status: "published",
      external_post_id: postIds?.[0] || initJson.data.publish_id,
      external_url: postIds?.[0]
        ? `https://www.tiktok.com/@/video/${postIds[0]}`
        : undefined,
      result: { mode: "FILE_UPLOAD", status: polled.raw },
      token_update: tokenUpdate,
    };
  }

  return {
    status: "failed",
    error_message: `TikTok 게시 상태: ${polled.status}`,
    result: polled.raw,
    token_update: tokenUpdate,
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
      "계정 탭에서 YouTube OAuth를 연결하면 자동 업로드됩니다.",
      "또는 YouTube Studio에서 세로 영상을 올리고 제목에 #Shorts 를 넣으세요.",
    ],
    tiktok: [
      "계정 탭에서 TikTok OAuth를 연결하면 자동 게시/Inbox 업로드가 됩니다.",
      "또는 틱톡 앱에서 영상·캡션을 직접 업로드하세요.",
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

  if (platform === "youtube_shorts") {
    if (!account?.access_token && !account?.refresh_token) {
      return manualPackage(platform, caption, mediaUrl, title);
    }
    return youtubeShortsPublish({ env, account, mediaUrl, caption, title });
  }

  if (platform === "tiktok") {
    if (!account?.access_token && !account?.refresh_token) {
      return manualPackage(platform, caption, mediaUrl, title);
    }
    return tiktokPublish({ env, account, mediaUrl, caption, title });
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

  const pack = r[platform] as { caption?: unknown; script?: unknown } | undefined;
  if (pack?.caption) return fromCaptionObj(pack.caption);
  if (r.caption || r.description || r.hashtags) return fromCaptionObj(r);
  if (typeof r.full_script === "string") {
    return { caption: r.full_script, title: (r.title_ideas as string[] | undefined)?.[0] };
  }
  return { caption: JSON.stringify(r).slice(0, 2000) };
}
