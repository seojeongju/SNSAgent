# -*- coding: utf-8 -*-
"""SNSAgent TikTok analysis / Korean short-form content generation."""
import json
from typing import Any, Dict, List, Optional

import pandas as pd
import pandasai as pai

from common.ais.chatgpt import ChatGPT
from common.utils.logging import setup_logger
from config import settings

logger = setup_logger(__name__)

try:
    pai.api_key.set(settings.pandas_ai_api_key or getattr(settings, "pandas_api_key", None))
except Exception:
    pass


async def clean_raw_data(
    user_request: str,
    tiktok_data: List[Dict],
    next_step: Optional[str] = None,
) -> Any:
    try:
        df_raw = pd.json_normalize(tiktok_data)
        df_raw.columns = df_raw.columns.str.replace(r"\W+", "_", regex=True)
    except Exception as e:
        logger.error(f"Failed to create DataFrame: {e}")
        return None

    df = pai.DataFrame(df_raw)
    system_prompt = (
        "You are a prompt engineer specializing in generating instructions for pandasai. "
        "Output ONLY a concise instruction for numeric/date filtering based on the user request."
    )
    user_prompt = (
        f"User request:\n{user_request}\n\n"
        f"Available columns:\n{df_raw.columns.tolist()}\n\n"
        f"Next step:\n{next_step}\n"
    )
    chatgpt = ChatGPT()
    try:
        response = await chatgpt.chat(system_prompt, user_prompt)
        pandasai_prompt = response["response"]["choices"][0]["message"]["content"].strip()
        return df.chat(pandasai_prompt)
    except Exception as e:
        logger.error(f"TikTok clean_raw_data failed: {e}")
        return None


async def _generate(platform: str, content_type: str, topic: str, **kwargs) -> Dict[str, Any]:
    from common.ais.prompts import build_content_user_prompt, get_short_form_system_prompt

    system_prompt = get_short_form_system_prompt(platform, content_type)
    user_prompt = build_content_user_prompt(
        topic,
        platform=platform,
        content_type=content_type,
        **kwargs,
    )
    chatgpt = ChatGPT()
    try:
        response = await chatgpt.chat(system_prompt, user_prompt)
        content = response["response"]["choices"][0]["message"]["content"].strip()
        content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"Failed to generate {platform} {content_type}: {e}")
        return {"status": False, "error": str(e), "language": "ko", "platform": platform}


async def generate_tiktok_script(
    topic: str,
    tone: str = "트렌디하고 에너지 있는",
    target_audience: str = "대한민국 틱톡 시청자",
    duration_sec: int = 30,
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """틱톡용 한국어 대본을 생성한다."""
    return await _generate(
        "tiktok",
        "script",
        topic,
        tone=tone,
        target_audience=target_audience,
        duration_sec=duration_sec,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )


async def generate_tiktok_caption(
    topic: str,
    tone: str = "트렌디하고 에너지 있는",
    target_audience: str = "대한민국 틱톡 시청자",
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """틱톡용 한국어 캡션·해시태그를 생성한다."""
    return await _generate(
        "tiktok",
        "caption",
        topic,
        tone=tone,
        target_audience=target_audience,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )
