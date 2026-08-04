# -*- coding: utf-8 -*-
"""
@file: SNSAgent/core/reasoning/module.py
@desc: Reasoning module for analyzing user input and generating corresponding workflows.
@auth: Callmeiks
"""
import json
import re
from typing import Any, Dict, List, Tuple, Optional
import uuid
from datetime import datetime

from common.ais.chatgpt import ChatGPT
from common.ais.prompts import (
    build_workflow_system_prompt,
    build_workflow_user_prompt,
    build_workflow_parameter_update_system_prompt,
    build_workflow_parameter_update_user_prompt,
)
from common.models.messages import ChatMessage, UserInput
from config import settings
from common.exceptions.exceptions import AnalysisError, ChatGPTAPIError
from common.models.workflows import WorkflowDefinition, MissingParameter,  ParameterConflict, WorkflowStep, Parameter, ParameterValidationResult
from common.utils.logging import setup_logger

# Set up logger
logger = setup_logger(__name__)


class ReasoningModule:
    """
    Simplified Reasoning Module that uses ChatGPT to analyze user requests
    and determine the appropriate workflow of sub-agents.
    """

    def __init__(self, api_keys: Optional[Dict[str, str]] = None):
        """Initialize the reasoning module with configuration."""
        self.config = settings
        self.chatgpt = ChatGPT(openai_api_key=api_keys['openai'])


    async def analyze_request_and_build_workflow(self,
                                                 user_input: UserInput,
                                                 agent_registry: Dict[str, Any],
                                                 chat_history: List[ChatMessage] = None,
                                                 existing_workflow: Dict[str, Any] = None) -> Tuple[WorkflowDefinition, ParameterValidationResult, Dict[str, Any]]:
        """
        Analyze user request and build workflow using ChatGPT.
        Handles both new requests and parameter updates for existing workflows.

        Args:
            user_input: input that contains both request and file
            agent_registry: Registry of available agents and functions
            chat_history: Optional chat history for context
            existing_workflow: Optional existing workflow to update

        Returns:
            Tuple[WorkflowDefinition, List[MissingParameter]]:
                - Workflow definition with steps
                - List of missing parameters (empty if none)

        Raises:
            AnalysisError: If analysis fails
        """
        try:
            if existing_workflow:
                logger.info("🤖🔍Analyzing parameter update for existing workflow...")
                # This is a parameter update for an existing workflow
                workflow_data = await self._update_workflow_parameters(
                    user_input,
                    existing_workflow,
                    agent_registry
                )
            else:
                logger.info("Analyzing new user request....")
                # This is a new request
                workflow_data = await self._create_new_workflow(
                    user_input,
                    agent_registry,
                    chat_history
                )

            cost = workflow_data.get('cost', {})

            # Convert to proper model objects
            workflow = self._convert_to_workflow_definition(workflow_data)
            missing_parameters = self._extract_missing_parameters(workflow_data)
            parameter_conflicts = self._extract_parameter_conflicts(workflow_data)

            # Create parameter validation result
            parameter_validation_result = ParameterValidationResult(
                is_valid=False if missing_parameters or parameter_conflicts else True,
                missing_required_parameters=missing_parameters,
                parameter_conflicts=parameter_conflicts
            )

            return workflow, parameter_validation_result, cost

        except Exception as e:
            logger.error(f"Error analyzing request: {str(e)}")
            raise AnalysisError(f"Failed to analyze request: {str(e)}")

    async def _create_new_workflow(self,
                                   user_input: UserInput,
                                   agent_registry: Dict[str, Any],
                                   chat_history: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Create a new workflow based on user request.

        Args:
            user_request: The user's request text
            agent_registry: Registry of available agents and functions
            chat_history: Optional chat history for context

        Returns:
            Dict[str, Any]: New workflow definition
        """
        # Prepare the prompt for ChatGPT
        user_request = user_input.text
        user_files = user_input.files

        full_file_content = ""
        for file in user_files:
            full_file_content +=file.file_content

        logger.info(f"full_file_content: {full_file_content}")

        system_message = build_workflow_system_prompt(agent_registry)
        user_message = build_workflow_user_prompt(user_request, full_file_content, chat_history)

        # Call ChatGPT API
        result = await self.chatgpt.chat(system_message, user_message)

        logger.info("Successfully generated new workflow from ChatGPT")

        # extract workflow data
        workflow = result['response']["choices"][0]["message"]["content"].strip()
        workflow = re.sub(r"^```(?:json)?\s*", "", workflow)
        workflow = re.sub(r"\s*```$", "", workflow)
        workflow = json.loads(workflow)
        workflow['cost'] = result['cost']

        return workflow

    async def _update_workflow_parameters(self,
                                          user_input: UserInput,
                                          existing_workflow: Dict[str, Any],
                                          agent_registry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Update an existing workflow with parameters from user input.

        Args:
            user_input: The user's input containing parameters
            existing_workflow: The existing workflow to update
            agent_registry: Registry of available agents and functions

        Returns:
            Dict[str, Any]: Updated workflow definition
        """
        # Prepare the prompt for ChatGPT
        system_message = build_workflow_parameter_update_system_prompt(agent_registry)
        user_message = build_workflow_parameter_update_user_prompt(user_input, existing_workflow)

        # Call ChatGPT API
        result = await self.chatgpt.chat(system_message, user_message)

        logger.info("Successfully updated workflow parameters")

        # extract workflow data
        updated_workflow = result['response']["choices"][0]["message"]["content"]
        updated_workflow = re.sub(r"^```(?:json)?\s*", "", updated_workflow)
        updated_workflow = re.sub(r"\s*```$", "", updated_workflow)
        updated_workflow = json.loads(updated_workflow)
        updated_workflow['cost'] = result['cost']

        return updated_workflow

    def _convert_to_workflow_definition(self, workflow_data: Dict[str, Any]) -> WorkflowDefinition:
        """Convert raw workflow data to WorkflowDefinition object."""
        # Create WorkflowStep objects
        steps = []
        for step_data in workflow_data.get("steps", []):
            step = WorkflowStep(
                step_id=step_data.get("step_id", str(uuid.uuid4())),
                agent_id=step_data.get("agent_id", ""),
                function_id=step_data.get("function_id", ""),
                description=step_data.get("description", ""),
                parameters=step_data.get("parameters", {}),
                return_type=step_data.get("return_type", {}),
            )
            steps.append(step)

        # Create WorkflowDefinition
        workflow = WorkflowDefinition(
            workflow_id=workflow_data.get("workflow_id", str(uuid.uuid4())),
            name=workflow_data.get("name", "Untitled Workflow"),
            description=workflow_data.get("description", ""),
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            steps=steps,
            output_format="json"
        )

        return workflow

    def _extract_missing_parameters(self, workflow_data: Dict[str, Any]) -> List[MissingParameter]:
        """Extract missing parameters from workflow data."""
        missing_params = []

        for param_data in workflow_data.get("missing_parameters", []):
            if param_data.get('step_id') != 'step1':
                continue
            missing_param = MissingParameter(
                name=param_data.get("name", ""),
                type=param_data.get("type", "string"),
                description=param_data.get("description", ""),
                required=param_data.get("required", True),
                function_id=param_data.get("function_id", ""),
                step_id="step1",  # Only for the first step
            )
            missing_params.append(missing_param)

        return missing_params

    def _extract_parameter_conflicts(self, workflow_data)-> List[ParameterConflict]:
        """Extract parameter conflicts from workflow data."""
        conflicts = []

        for conflict_data in workflow_data.get("parameter_conflicts", []):
            conflict = ParameterConflict(
                parameter=conflict_data.get("parameter1", ""),
                function_id=conflict_data.get("function_id", ""),
                step_id=conflict_data.get("step_id", "step1"),
                reason=conflict_data.get("reason", ""),
                resolution=conflict_data.get("resolution", None)
            )
            conflicts.append(conflict)

        return conflicts