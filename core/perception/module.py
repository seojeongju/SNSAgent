# -*- coding: utf-8 -*-
"""
@file: SNSAgent/core/perception/module.py
@desc: Perception Module for handling input validation, security checks, and output formatting.
       This module is responsible for:
       - Validating and sanitizing user input
       - Performing security checks
       - Clarifying ambiguous user requests
       - Formatting output for presentation
@auth: Callmeiks
@date: 2024-04-15
"""
from typing import Any, Dict, List, Optional, Union, Tuple
import json
import pandas as pd
from pandasai.core.response import DataFrameResponse
from pydantic import ValidationError

from common.ais.chatgpt import ChatGPT
from common.ais.prompts import (
    CLARIFY_SYSTEM_PROMPT,
    OUTPUT_FORMATTER_SYSTEM_PROMPT,
    build_clarify_user_prompt,
    build_output_formatter_user_prompt,
)
from common.security.validators import SecurityValidator
from common.security.sanitizers import InputSanitizer, FileValidator
from common.utils.logging import setup_logger
from common.exceptions.exceptions import (
    InputValidationError, OutputFormattingError
)
from common.models.messages import (
    UserInput, ValidationResult, FormattedOutput,
)

# Set up logger
logger = setup_logger(__name__)
PRIMITIVES = (str, bool, int, float)


class PerceptionModule:

    def __init__(self, api_keys: Optional[Dict[str, str]] = None):
        """
        Initialize the perception module with validators and sanitizers.

        Initializes:
        - SecurityValidator: For checking input for security issues
        - InputSanitizer: For cleaning and normalizing input
        - FileValidator: For validating file uploads
        - ChatGPT: For clarifying ambiguous requests and formatting output
        """
        self.security_validator = SecurityValidator()
        self.input_sanitizer = InputSanitizer()
        self.file_validator = FileValidator()
        self.chatgpt = ChatGPT(openai_api_key=api_keys['openai'])

    async def clarify_user_request(self, user_request: str) -> Dict[str, Any]:
        """
        Use GPT to clarify and rephrase a user request into a clear, goal-oriented instruction.

        Args:
            user_request (str): The original user request in natural language.

        Returns:
            Dict[str, Any]: A dictionary containing:
                - is_valid (bool): Whether the request is actionable
                - rephrased_request (str): The clarified request (if valid)
                - reason (str): Explanation if request is invalid

        Example:
            {
                "is_valid": True,
                "rephrased_request": "인공지능 주제로 인스타그램 릴스용 한국어 대본과 캡션을 생성해 주세요",
                "reason": None
            }
        """
        system_prompt = CLARIFY_SYSTEM_PROMPT
        user_prompt = build_clarify_user_prompt(user_request)

        result = await self.chatgpt.chat(system_prompt, user_prompt)
        response = json.loads(result['response']["choices"][0]["message"]["content"].strip())
        logger.info(f"Clarified request: {response}")
        response['cost'] = result['cost']

        return response

    async def validate_input(self, input_data: Union[Dict[str, Any], UserInput]) -> Tuple[
        ValidationResult, Dict[str, Any]]:
        """
        Validate and sanitize user input.

        This method performs several validation steps:
        1. Converts input to UserInput model if needed
        2. Performs security checks on text input
        3. Validates file uploads if present
        4. Sanitizes the input
        5. Clarifies ambiguous text input

        Args:
            input_data (Union[Dict[str, Any], UserInput]): The user input data to validate

        Returns:
            ValidationResult: The validation result containing:
                - is_valid (bool): Whether the input is valid
                - errors (List[Dict]): Any validation errors
                - sanitized_input (Dict): The cleaned input if valid

        Raises:
            InputValidationError: If input validation fails
        """
        try:
            # Convert to UserInput if dict
            if isinstance(input_data, dict):
                input_data = UserInput(**input_data)

            logger.info("Validating user input", {"user_id": input_data.metadata.user_id})
            errors, cost = [], {}

            # Security check
            if input_data.text:
                sec_check = self.security_validator.check_for_injection(input_data.text)
                if not sec_check.is_safe:
                    issues = [issue.dict() for issue in sec_check.detected_issues]
                    logger.warning("Security check failed", {"user_id": input_data.metadata.user_id, "issues": issues})
                    return ValidationResult(
                        is_valid=False,
                        errors=[{
                            "type": "security",
                            "details": issues,
                            "message": "Request contains potentially harmful content."
                        }]
                    ), cost

            # File validation
            if input_data.files:
                for file_info in input_data.files:
                    validation = self.file_validator.validate_file(file_info.filename, file_info.size)
                    if not validation["is_allowed"]:
                        return ValidationResult(
                            is_valid=False,
                            errors=[{
                                "type": "file",
                                "details": validation["reason"],
                                "message": f"File '{file_info.filename}' not allowed. {validation['reason']}"
                            }]
                        ), cost

            # Input sanitization
            sanitized_input = self.input_sanitizer.sanitize_input(input_data)

            # Clarify ambiguous text input
            if sanitized_input.get('text'):
                clarification = await self.clarify_user_request(sanitized_input['text'])
                cost = clarification.get("cost", {})
                if clarification.get("is_valid"):
                    sanitized_input['text'] = clarification['rephrased_request']
                else:
                    return ValidationResult(
                        is_valid=False,
                        errors=[{
                            "type": "clarification",
                            "details": clarification['reason'],
                            "message": f"Request clarification failed: {clarification['reason']}"
                        }]
                    ), cost

            return ValidationResult(is_valid=True, sanitized_input=sanitized_input), cost

        except Exception as e:
            logger.error(
                "Unexpected error during input validation",
                {"error": str(e)}
            )
            raise InputValidationError(
                "Failed to validate input",
                {"details": str(e)}
            )

    async def get_gpt_response(self, result: Any, user_input_text: str) -> tuple[Any, Any]:
        """
        Generate the opening response for the user using GPT.

        Args:
            result (Any): The result data to include in the response
            user_input_text (str): The original user input text

        Returns:
            str: The generated response text

        Raises:
            OutputFormattingError: If the output format is not supported
        """
        system_prompt = OUTPUT_FORMATTER_SYSTEM_PROMPT
        user_prompt = build_output_formatter_user_prompt(user_input_text, result)

        result = await self.chatgpt.chat(system_prompt, user_prompt)
        response = result['response']["choices"][0]["message"]["content"].strip()
        cost = result["cost"]

        return response, cost

    async def format_output(self, result: Any, user_input_text: str) -> Tuple[FormattedOutput, Dict]:
        """
        Format the output for presentation to the user.

        Args:
            result (Any): The result data to format
            user_input_text (str): The original user input text

        Returns:
            FormattedOutput: The formatted output containing:
                - type (str): The type of output
                - content (Any): The formatted content
                - format (str): The output format

        Raises:
            OutputFormattingError: If formatting fails or format is not supported
        """
        logger.info("Formatting output")
        content = {
            "opener": "",
            "data": None,
        }
        try:
            opener, cost = await self.get_gpt_response(result, user_input_text)
            content["opener"] = opener

            if isinstance(result, DataFrameResponse):
                content["data"] = result.value
            elif isinstance(result, Dict) or isinstance(result, List):
                content["data"] = result

            return FormattedOutput(type="data", content=content, format="json"), cost

        except Exception as e:
            logger.error("Output formatting error", {"error": str(e)})
            raise OutputFormattingError(f"Failed to format output", {"details": str(e)})