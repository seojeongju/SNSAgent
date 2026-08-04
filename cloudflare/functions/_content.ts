/**
 * Shared content-generation helpers for SNSAgent Pages Functions.
 * Focus platforms: Instagram Reels, YouTube Shorts, TikTok, Facebook.
 */

export type Platform =
  | "instagram_reels"
  | "youtube_shorts"
  | "tiktok"
  | "facebook"
  | "all";

export type ContentType = "script" | "caption" | "bundle";

const LANGUAGE_POLICY =
  "모든 사용자 대면 텍스트는 반드시 자연스러운 한국어로 작성한다. 영어로 번역하지 않는다.";

const COMMON_RULES = `숏폼 공통:
- 15~60초 가정, 첫 1~3초 훅
- 구어체 한국어, CTA 포함
- 해시태그 5~12개
- JSON만 출력`;

const SCRIPT_SCHEMA = `{
  "platform":"<platform>",
  "language":"ko",
  "title_ideas":["제목1","제목2","제목3"],
  "estimated_duration_sec":35,
  "hook":"훅",
  "scenes":[{"scene":1,"duration_sec":5,"visual":"화면","on_screen_text":"자막","narration":"나레이션"}],
  "full_script":"전체 대본",
  "cta":"CTA",
  "notes":"팁"
}`;

const CAPTION_SCHEMA_IG = `{
  "platform":"instagram_reels","language":"ko",
  "caption":"...","first_line_hook":"...","hashtags":["#a"],
  "alt_captions":["..."],"cta_question":"..."
}`;

const CAPTION_SCHEMA_YT = `{
  "platform":"youtube_shorts","language":"ko",
  "titles":["..."],"description":"...","hashtags":["#Shorts"],
  "tags":["..."],"pinned_comment":"..."
}`;

const CAPTION_SCHEMA_TT = `{
  "platform":"tiktok","language":"ko",
  "caption":"...","hashtags":["#틱톡"],
  "alt_captions":["..."],"cta_question":"..."
}`;

const CAPTION_SCHEMA_FB = `{
  "platform":"facebook","language":"ko",
  "caption":"...","first_line_hook":"...","hashtags":["#페이스북"],
  "alt_captions":["..."],"cta_question":"..."
}`;

function platformLabel(platform: Platform): string {
  switch (platform) {
    case "instagram_reels":
      return "인스타그램 릴스";
    case "youtube_shorts":
      return "유튜브 쇼츠";
    case "tiktok":
      return "틱톡";
    case "facebook":
      return "페이스북";
    case "all":
      return "인스타그램 릴스+유튜브 쇼츠+틱톡+페이스북";
  }
}

export function getSystemPrompt(platform: Platform, contentType: ContentType): string {
  if (contentType === "bundle" || platform === "all") {
    return `당신은 한국어 숏폼 콘텐츠 디렉터입니다.
${LANGUAGE_POLICY}
${COMMON_RULES}
4개 플랫폼(instagram_reels, youtube_shorts, tiktok, facebook)용 script+caption을 모두 만드세요.
JSON:
{
  "language":"ko",
  "topic_summary":"...",
  "instagram_reels":{"script":{},"caption":{}},
  "youtube_shorts":{"script":{},"caption":{}},
  "tiktok":{"script":{},"caption":{}},
  "facebook":{"script":{},"caption":{}}
}`;
  }

  const role =
    contentType === "script"
      ? `${platformLabel(platform)} 전문 한국어 대본 작가`
      : `${platformLabel(platform)} 전문 한국어 캡션 작가`;

  let schema = SCRIPT_SCHEMA.replace("<platform>", platform);
  if (contentType === "caption") {
    if (platform === "instagram_reels") schema = CAPTION_SCHEMA_IG;
    else if (platform === "youtube_shorts") schema = CAPTION_SCHEMA_YT;
    else if (platform === "tiktok") schema = CAPTION_SCHEMA_TT;
    else schema = CAPTION_SCHEMA_FB;
  }

  return `당신은 ${role}입니다.
${LANGUAGE_POLICY}
${COMMON_RULES}
반드시 아래 JSON 스키마만 출력:
${schema}`;
}

export function getUserPrompt(input: {
  platform: Platform;
  contentType: ContentType;
  topic: string;
  tone?: string;
  targetAudience?: string;
  durationSec?: number;
  brandOrProduct?: string;
  extraNotes?: string;
}): string {
  const parts = [
    `플랫폼: ${platformLabel(input.platform)}`,
    `생성 유형: ${input.contentType}`,
    `주제/메시지:\n${input.topic}`,
    `톤앤매너: ${input.tone ?? "친근하고 신뢰감 있는"}`,
    `타깃: ${input.targetAudience ?? "대한민국 일반 시청자"}`,
    `목표 길이(초): ${input.durationSec ?? 35}`,
    "출력 언어: 한국어",
  ];
  if (input.brandOrProduct) parts.push(`브랜드/제품: ${input.brandOrProduct}`);
  if (input.extraNotes) parts.push(`추가 요청:\n${input.extraNotes}`);
  parts.push("위 조건으로 JSON만 출력하세요.");
  return parts.join("\n\n");
}

export function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}
