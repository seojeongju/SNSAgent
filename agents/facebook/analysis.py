# -*- coding: utf-8 -*-
"""SNSAgent Facebook analysis / Korean short-form content generation."""
import json
from typing import Any, Dict

from common.ais.chatgpt import ChatGPT
from common.utils.logging import setup_logger

logger = setup_logger(__name__)


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


async def generate_facebook_script(
    topic: str,
    tone: str = "친절하고 이해하기 쉬운",
    target_audience: str = "대한민국 일반 페이스북 사용자",
    duration_sec: int = 35,
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """페이스북 릴스/숏폼용 한국어 대본을 생성한다."""
    return await _generate(
        "facebook",
        "script",
        topic,
        tone=tone,
        target_audience=target_audience,
        duration_sec=duration_sec,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )


async def generate_facebook_caption(
    topic: str,
    tone: str = "친절하고 이해하기 쉬운",
    target_audience: str = "대한민국 일반 페이스북 사용자",
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """페이스북용 한국어 캡션·해시태그를 생성한다."""
    return await _generate(
        "facebook",
        "caption",
        topic,
        tone=tone,
        target_audience=target_audience,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )
