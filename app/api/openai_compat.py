import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import require_api_access
from app.core.activity_logger import log_event
from app.core.db import get_db
from app.core.inference_manager import InferenceManager
from app.core.token_usage import record_token_usage
from app.core.web_search import WEB_SEARCH_TOOL_DEFINITION, get_search_provider, parse_sse_chunks
from app.models.app_settings import AppSettings
from app.models.model_config import ModelConfig
from app.models.user import User
from app.models.web_search_provider import WebSearchProvider as WebSearchProviderModel
from app.utils.schemas import OpenAIChatRequest

logger = logging.getLogger(__name__)

_WEB_SEARCH_MAX_ITERATIONS = 5

router = APIRouter(prefix="/v1", tags=["openai"])


THINKING_DISABLED_PROMPT = "Pawpile thinking mode: off. Do not include reasoning, chain-of-thought, or thought process. Reply with only the final answer."
THINKING_ENABLED_PROMPT = "Pawpile thinking mode: on. Include your reasoning before the final answer when the model supports it."
THINKING_CONTROL_RULES = {
    "qwen": {
        True: ["/think", THINKING_ENABLED_PROMPT],
        False: ["/no_think", THINKING_DISABLED_PROMPT],
    },
    "gemma": {
        True: [THINKING_ENABLED_PROMPT],
        False: [THINKING_DISABLED_PROMPT],
    },
}
KNOWN_THINKING_CONTROL_LINES = {
    line
    for controls in THINKING_CONTROL_RULES.values()
    for lines in controls.values()
    for line in lines
}
KNOWN_THINKING_CONTROL_LINES.update({THINKING_DISABLED_PROMPT, THINKING_ENABLED_PROMPT})


def _coerce_usage_count(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None

    if isinstance(value, int):
        return value if value > 0 else None

    if isinstance(value, float):
        coerced = int(value)
        return coerced if coerced > 0 else None

    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            coerced = int(text)
        except ValueError:
            return None
        return coerced if coerced > 0 else None

    return None


def _record_usage(usage: Any, *, db: Session, user_id: int | None) -> bool:
    if not isinstance(usage, dict):
        return False

    total_tokens = _coerce_usage_count(usage.get("total_tokens"))
    if total_tokens is None:
        total_tokens = _coerce_usage_count(usage.get("totalTokens"))
    input_tokens = _coerce_usage_count(usage.get("prompt_tokens"))
    if input_tokens is None:
        input_tokens = _coerce_usage_count(usage.get("promptTokens"))
    output_tokens = _coerce_usage_count(usage.get("completion_tokens"))
    if output_tokens is None:
        output_tokens = _coerce_usage_count(usage.get("completionTokens"))

    if total_tokens is None and input_tokens is None and output_tokens is None:
        return False

    return record_token_usage(
        db,
        user_id=user_id,
        total_tokens=total_tokens,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def _record_usage_from_sse_chunk(chunk: bytes | str, *, db: Session, user_id: int | None) -> bool:
    if isinstance(chunk, bytes):
        chunk = chunk.decode("utf-8", errors="replace")

    for event in chunk.replace("\r\n", "\n").split("\n\n"):
        if not event.strip():
            continue

        for line in event.split("\n"):
            if not line.startswith("data:"):
                continue

            payload_str = line[5:].strip()
            if not payload_str or payload_str == "[DONE]":
                continue

            try:
                payload = json.loads(payload_str)
            except (json.JSONDecodeError, ValueError):
                continue

            if _record_usage(payload.get("usage"), db=db, user_id=user_id):
                return True

    return False


def _model_family(model: ModelConfig) -> str | None:
    model_identity = " ".join(
        part.lower()
        for part in (model.alias, model.file_name, model.model_dir_name)
        if part
    )
    for family in THINKING_CONTROL_RULES:
        if family in model_identity:
            return family
    return None


def _resolve_enable_thinking(payload: OpenAIChatRequest, model: ModelConfig) -> bool:
    if model.discourage_thinking:
        return False
    if payload.enable_thinking is not None:
        return payload.enable_thinking
    return True


def _strip_known_thinking_control_lines(text: str) -> str:
    cleaned_lines = [
        line
        for line in text.splitlines()
        if line.strip() not in KNOWN_THINKING_CONTROL_LINES
    ]
    return "\n".join(cleaned_lines).strip()


def _thinking_control_lines(model: ModelConfig, enabled: bool) -> list[str]:
    lines = [THINKING_ENABLED_PROMPT if enabled else THINKING_DISABLED_PROMPT]
    family = _model_family(model)
    if family is None:
        return lines

    for line in THINKING_CONTROL_RULES[family][enabled]:
        if line not in lines:
            lines.append(line)
    return lines


def _prepend_system_lines(content: str | list[dict], prefix_lines: list[str]) -> str | list[dict]:
    prefix = "\n".join(prefix_lines)
    if isinstance(content, str):
        existing = _strip_known_thinking_control_lines(content)
        return f"{prefix}\n{existing}" if existing else prefix

    for index, part in enumerate(content):
        if isinstance(part, dict) and part.get("type") == "text":
            existing = _strip_known_thinking_control_lines(part.get("text") or "")
            updated = {**part, "text": f"{prefix}\n{existing}" if existing else prefix}
            return [*content[:index], updated, *content[index + 1:]]

    return [{"type": "text", "text": prefix}, *content]


def _apply_thinking_controls(messages: list[dict], model: ModelConfig, enabled: bool) -> list[dict]:
    prefix_lines = _thinking_control_lines(model, enabled)
    if messages and messages[0].get("role") == "system":
        existing = messages[0].get("content") or ""
        return [
            {**messages[0], "content": _prepend_system_lines(existing, prefix_lines)},
            *messages[1:],
        ]

    return [{"role": "system", "content": "\n".join(prefix_lines)}, *messages]


def _get_active_web_search_provider(db: Session) -> Any | None:
    """Return an active, configured WebSearchProvider instance, or None."""
    settings = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if not settings or settings.active_web_search_provider_id is None:
        return None
    provider_row = (
        db.query(WebSearchProviderModel)
        .filter(
            WebSearchProviderModel.id == settings.active_web_search_provider_id,
            WebSearchProviderModel.enabled.is_(True),
        )
        .first()
    )
    if not provider_row or not provider_row.api_key:
        return None
    return get_search_provider(provider_row.provider_type, provider_row.api_key, provider_row.result_count)


async def _execute_web_searches(
    tool_calls: list[dict[str, Any]],
    provider: Any,
) -> list[dict[str, Any]]:
    """Execute web_search tool calls and return tool result messages."""
    result_messages: list[dict[str, Any]] = []
    for tc in tool_calls:
        if tc.get("function", {}).get("name") != "web_search":
            continue
        try:
            args = json.loads(tc.get("function", {}).get("arguments", "{}"))
            query = args.get("query", "")
            search_results = await provider.search(query)
            content = json.dumps(search_results, ensure_ascii=False)
        except Exception:
            logger.exception("Web search failed for tool call %s", tc.get("id"))
            content = json.dumps([{"error": "Search failed. Please try a different query."}])
        result_messages.append({
            "role": "tool",
            "tool_call_id": tc.get("id", ""),
            "content": content,
        })
    return result_messages


async def _run_web_search_non_streaming(
    inference: InferenceManager,
    model_id: int,
    request_payload: dict[str, Any],
    provider: Any,
) -> dict[str, Any]:
    """Run the agentic web search loop for non-streaming requests.

    Executes up to _WEB_SEARCH_MAX_ITERATIONS tool call turns, then returns
    the final text response.
    """
    messages = list(request_payload["messages"])
    tools = list(request_payload.get("tools") or [])

    for _ in range(_WEB_SEARCH_MAX_ITERATIONS):
        result = await inference.chat_completion(model_id, {**request_payload, "messages": messages, "tools": tools})
        choices = result.get("choices", [])
        if not choices:
            return result

        choice = choices[0]
        if choice.get("finish_reason") != "tool_calls":
            return result

        message = choice.get("message", {})
        tool_calls = message.get("tool_calls", [])
        web_search_calls = [tc for tc in tool_calls if tc.get("function", {}).get("name") == "web_search"]
        if not web_search_calls:
            # Non-web-search tool calls — return as-is so the client can handle them
            return result

        messages = messages + [message]
        tool_results = await _execute_web_searches(web_search_calls, provider)
        messages = messages + tool_results

    # Exhausted iterations — request a final text answer without tools
    return await inference.chat_completion(model_id, {**request_payload, "messages": messages, "tools": []})


async def _stream_with_web_search(
    inference: InferenceManager,
    model_id: int,
    request_payload: dict[str, Any],
    provider: Any,
):
    """Async generator for streaming responses with web search support.

    Runs tool call turns as non-streaming internally, then streams the final answer.
    """
    messages = list(request_payload["messages"])
    tools = list(request_payload.get("tools") or [])
    stream_options = dict(request_payload.get("stream_options") or {})
    stream_options.setdefault("include_usage", True)

    for iteration in range(_WEB_SEARCH_MAX_ITERATIONS):
        # For the last iteration, strip tools to force a text response
        current_tools = [] if iteration == _WEB_SEARCH_MAX_ITERATIONS - 1 else tools

        # Preserve usage in the buffered stream so the UI can compute token stats
        # even when web search is enabled but no tool call is actually made.
        buffered: list[bytes] = []
        intermediate_payload = dict(request_payload)
        intermediate_payload["stream"] = True
        intermediate_payload["messages"] = messages
        intermediate_payload["tools"] = current_tools
        intermediate_payload["stream_options"] = stream_options
        async for chunk in inference.stream_chat_completion(model_id, intermediate_payload):
            buffered.append(chunk)

        message, finish_reason = parse_sse_chunks(buffered)
        tool_calls = message.get("tool_calls", [])
        web_search_calls = [tc for tc in tool_calls if tc.get("function", {}).get("name") == "web_search"]

        if finish_reason != "tool_calls" or not web_search_calls:
            # Final answer — stream it out
            for chunk in buffered:
                yield chunk
            return

        # Execute searches and continue loop
        messages = messages + [message]
        tool_results = await _execute_web_searches(web_search_calls, provider)
        messages = messages + tool_results

    # Exhausted iterations — stream the final answer without tools
    final_payload = dict(request_payload)
    final_payload["stream"] = True
    final_payload["messages"] = messages
    final_payload["tools"] = []
    final_payload["stream_options"] = stream_options
    async for chunk in inference.stream_chat_completion(model_id, final_payload):
        yield chunk


@router.get("/models")
def v1_models(_: User = Depends(require_api_access), db: Session = Depends(get_db)) -> dict:
    active_web_search_provider = _get_active_web_search_provider(db)
    models = (
        db.query(ModelConfig)
        .filter(ModelConfig.activated.is_(True))
        .order_by(ModelConfig.priority.asc(), ModelConfig.id.asc())
        .all()
    )
    return {
        "object": "list",
        "data": [
            {
                "id": m.alias,
                "object": "model",
                "created": int(time.time()),
                "owned_by": "pawpile",
                "discourage_thinking": m.discourage_thinking,
                "vision_enabled": m.vision_enabled,
                "web_search_enabled": m.web_search_enabled,
                "web_search_available": m.web_search_enabled and m.tool_calling_enabled and active_web_search_provider is not None,
            }
            for m in models
        ],
    }


@router.post("/chat/completions")
async def v1_chat_completions(payload: OpenAIChatRequest, current_user: User = Depends(require_api_access), db: Session = Depends(get_db)):
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]
    model = (
        db.query(ModelConfig)
        .filter(ModelConfig.alias == payload.model, ModelConfig.activated.is_(True))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Model not found or not active")

    if payload.requests_tooling():
        if not model.tool_calling_enabled:
            raise HTTPException(
                status_code=400,
                detail="Tool calling is disabled for this model. Enable tool calling in the model settings before sending tool requests.",
            )

    web_search_requested = payload.use_web_search if payload.use_web_search is not None else model.web_search_enabled

    if web_search_requested and not model.web_search_enabled:
        raise HTTPException(
            status_code=400,
            detail="Web search is disabled for this model. Enable it in the model settings before requesting search.",
        )

    if web_search_requested and not model.tool_calling_enabled:
        raise HTTPException(
            status_code=400,
            detail="Web search requires tool calling to be enabled for this model. Enable tool calling in the model settings.",
        )

    if payload.requests_vision() and not model.vision_enabled:
        raise HTTPException(
            status_code=400,
            detail="Vision is disabled for this model. Enable vision in the model settings before sending image requests.",
        )

    log_event(
        db,
        "chat.completion",
        user_id=current_user.id,
        username=current_user.username,
        details={"model": model.alias, "stream": payload.stream},
    )

    request_payload = payload.model_dump(exclude_none=True)
    if "temperature" not in request_payload:
        request_payload["temperature"] = model.temperature
    if "top_p" not in request_payload:
        request_payload["top_p"] = model.top_p
    if "top_k" not in request_payload:
        request_payload["top_k"] = model.top_k
    if "presence_penalty" not in request_payload:
        request_payload["presence_penalty"] = model.presence_penalty
    if "repetition_penalty" not in request_payload:
        request_payload["repetition_penalty"] = model.repetition_penalty
    request_payload["enable_thinking"] = _resolve_enable_thinking(payload, model)
    request_payload["messages"] = [
        {
            key: value
            for key, value in message.model_dump(exclude_none=True).items()
            if key != "content" or value != ""
        }
        for message in payload.messages
    ]

    # Some llama-server/model combinations do not reliably honor the generic
    # enable_thinking flag. Inject a model-aware system directive so saved
    # model defaults and API overrides stay effective for affected families.
    request_payload["messages"] = _apply_thinking_controls(
        request_payload["messages"],
        model,
        bool(request_payload.get("enable_thinking", True)),
    )

    # Web search: inject the web_search tool and run the agentic loop if enabled
    active_web_search_provider = _get_active_web_search_provider(db) if web_search_requested else None
    if payload.use_web_search and active_web_search_provider is None:
        raise HTTPException(
            status_code=400,
            detail="No active web search provider is configured. Select one in Settings > Web Search before requesting search.",
        )

    if active_web_search_provider is not None:
        existing_tools = list(request_payload.get("tools") or [])
        already_has_web_search = any(
            t.get("function", {}).get("name") == "web_search"
            for t in existing_tools
            if t.get("type") == "function"
        )
        if not already_has_web_search:
            request_payload["tools"] = existing_tools + [WEB_SEARCH_TOOL_DEFINITION]

        if payload.stream:
            async def web_search_event_stream():
                usage_recorded = False
                try:
                    async for chunk in _stream_with_web_search(inference, model.id, request_payload, active_web_search_provider):
                        if not usage_recorded:
                            usage_recorded = _record_usage_from_sse_chunk(chunk, db=db, user_id=current_user.id)
                        yield chunk
                except RuntimeError as exc:
                    err_msg = str(exc).replace("\\", "\\\\").replace('"', '\\"')
                    yield f'data: {{"error": {{"message": "{err_msg}"}}}}\n\n'
                    yield "data: [DONE]\n\n"

            return StreamingResponse(web_search_event_stream(), media_type="text/event-stream")

        result = await _run_web_search_non_streaming(inference, model.id, request_payload, active_web_search_provider)
        _record_usage(result.get("usage"), db=db, user_id=current_user.id)
        return {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model.alias,
            "choices": result.get("choices", []),
            "usage": result.get("usage", {}),
        }

    if payload.stream:
        async def event_stream():
            usage_recorded = False
            try:
                async for chunk in inference.stream_chat_completion(model.id, {
                    **request_payload,
                    "stream_options": {"include_usage": True},
                }):
                    if not usage_recorded:
                        usage_recorded = _record_usage_from_sse_chunk(chunk, db=db, user_id=current_user.id)
                    yield chunk
            except RuntimeError as exc:
                message = str(exc).replace("\\", "\\\\").replace('"', '\\"')
                yield f'data: {{"error": {{"message": "{message}"}}}}\n\n'
                yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    result = await inference.chat_completion(model.id, request_payload)
    _record_usage(result.get("usage"), db=db, user_id=current_user.id)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model.alias,
        "choices": result.get("choices", []),
        "usage": result.get("usage", {}),
    }
