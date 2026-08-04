import json
import pandas as pd
from typing import List, Dict, Any

from common.ais.chatgpt import ChatGPT
from common.utils.logging import setup_logger

import pandasai as pai

from config import settings

logger = setup_logger(__name__)

pai.api_key.set(settings.pandas_api_key)

async def clean_raw_data(user_request: str, instagram_data: List[Dict], next_step: str = None) -> Any:
    """
    Clean raw x data dynamically based on user's request.
    Step 1: Use ChatGPT to generate a PandasAI prompt.
    Step 2: Use pandasai (pai.DataFrame) to process the data according to the prompt.

    Args:
        user_request: Description of the data cleaning request.
        instagram_data: Raw x data (list of dicts).
        next_step: Description of the next step and its expected parameters.

    Returns:
        Cleaned data (could be a list, dict, DataFrame, or any type depending on user request).
    """
    # Convert raw data to pandas DataFrame
    try:
        df_raw = pd.json_normalize(instagram_data)
        df_raw.columns = df_raw.columns.str.replace(r'\W+', '_', regex=True)  # <=== ✨ 加这一行
    except Exception as e:
        logger.error(f"Failed to create DataFrame: {e}")
        return None

    logger.info(df_raw.columns.tolist())

    # Prepare for pandasai
    df = pai.DataFrame(df_raw)

    # Ask ChatGPT to generate a smart PandasAI prompt
    system_prompt = (
        "You are a prompt engineer specializing in generating instructions for pandasai (an AI tool for DataFrames). "
        "Your task is to create a clear, direct instruction for pandasai to select specific column(s) and filter rows, "
        "based only on numeric comparisons (>, <, >=, <=, ==) according to (1) user request, (2) available data columns, and (3) an optional next step.\n\n"
        "Constraints:\n"
        "- Always explicitly mention the selected column(s) from the available columns.\n"
        "- Only numeric/date filtering is allowed; do not perform any text matching, substring search, or regular expression operations.\n"
        "- If user request involves non-numeric columns, politely ignore and focus only on numeric or date column filtering.\n"
        "- Keep the generated instruction actionable and concise.\n"
        "- Output ONLY the pure instruction text without any extra commentary or explanations."
    )

    user_prompt = (
        f"User request:\n{user_request}\n\n"
        f"Available columns:\n{df_raw.columns.tolist()}\n\n"
        f"Next step:\n{next_step}\n\n"
        "Now build the instruction text for pandasai."
    )

    chatgpt = ChatGPT()

    try:
        response = await chatgpt.chat(system_prompt, user_prompt)
        pandasai_prompt = response['response']["choices"][0]["message"]["content"].strip()
        logger.info(f"Generated PandasAI prompt: {pandasai_prompt}")
    except Exception as e:
        logger.error(f"Failed to generate PandasAI prompt: {e}")
        return None

    # Use pandasai DataFrame to execute the prompt
    try:
        cleaned_output = df.chat(pandasai_prompt)
        logger.info("PandasAI data cleaning completed successfully.")
    except Exception as e:
        logger.error(f"PandasAI execution failed: {e}")
        return None

    # logger.info(f"Cleaned output: {cleaned_output}")

    return cleaned_output


async def generate_reels_script(
    topic: str,
    tone: str = "친근하고 신뢰감 있는",
    target_audience: str = "대한민국 일반 시청자",
    duration_sec: int = 35,
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """인스타그램 릴스용 한국어 대본을 생성한다."""
    from common.ais.prompts import (
        get_short_form_system_prompt,
        build_content_user_prompt,
    )

    system_prompt = get_short_form_system_prompt("instagram_reels", "script")
    user_prompt = build_content_user_prompt(
        topic,
        platform="instagram_reels",
        content_type="script",
        tone=tone,
        target_audience=target_audience,
        duration_sec=duration_sec,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )
    chatgpt = ChatGPT()
    try:
        response = await chatgpt.chat(system_prompt, user_prompt)
        content = response["response"]["choices"][0]["message"]["content"].strip()
        content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"Failed to generate Reels script: {e}")
        return {"status": False, "error": str(e), "language": "ko", "platform": "instagram_reels"}


async def generate_reels_caption(
    topic: str,
    tone: str = "친근하고 신뢰감 있는",
    target_audience: str = "대한민국 일반 시청자",
    brand_or_product: str = "",
    extra_notes: str = "",
    reference_text: str = "",
) -> Dict[str, Any]:
    """인스타그램 릴스용 한국어 캡션·해시태그를 생성한다."""
    from common.ais.prompts import (
        get_short_form_system_prompt,
        build_content_user_prompt,
    )

    system_prompt = get_short_form_system_prompt("instagram_reels", "caption")
    user_prompt = build_content_user_prompt(
        topic,
        platform="instagram_reels",
        content_type="caption",
        tone=tone,
        target_audience=target_audience,
        brand_or_product=brand_or_product,
        extra_notes=extra_notes,
        reference_text=reference_text,
    )
    chatgpt = ChatGPT()
    try:
        response = await chatgpt.chat(system_prompt, user_prompt)
        content = response["response"]["choices"][0]["message"]["content"].strip()
        content = content.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        return json.loads(content)
    except Exception as e:
        logger.error(f"Failed to generate Reels caption: {e}")
        return {"status": False, "error": str(e), "language": "ko", "platform": "instagram_reels"}
