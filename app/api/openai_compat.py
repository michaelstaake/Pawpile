import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import require_api_access
from app.core.activity_logger import log_event
from app.core.db import get_db
from app.core.inference_manager import InferenceManager
from app.models.model_config import ModelConfig
from app.models.user import User
from app.utils.schemas import OpenAIChatRequest

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


def _strip_known_thinking_control_lines(text: str) -> str:
    cleaned_lines = [
        line
        for line in text.splitlines()
        if line.strip() not in KNOWN_THINKING_CONTROL_LINES
    ]
    return "\n".join(cleaned_lines).strip()


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
    family = _model_family(model)
    if family is None:
        return messages

    prefix_lines = THINKING_CONTROL_RULES[family][enabled]
    if messages and messages[0].get("role") == "system":
        existing = messages[0].get("content") or ""
        return [
            {**messages[0], "content": _prepend_system_lines(existing, prefix_lines)},
            *messages[1:],
        ]

    return [{"role": "system", "content": "\n".join(prefix_lines)}, *messages]


@router.get("/models")
def v1_models(_: User = Depends(require_api_access), db: Session = Depends(get_db)) -> dict:
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
                "thinking_enabled": m.thinking_enabled,
                "vision_enabled": m.vision_enabled,
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
    if "enable_thinking" not in request_payload:
        request_payload["enable_thinking"] = model.thinking_enabled
    request_payload["messages"] = [
        {
            key: value
            for key, value in message.model_dump(exclude_none=True).items()
            if key != "content" or value != ""
        }
        for message in payload.messages
    ]

    # Some llama-server/model combinations do not reliably honor the generic
    # enable_thinking flag. Inject a model-aware system directive so the web UI
    # toggle and API parameter stay effective for affected families.
    request_payload["messages"] = _apply_thinking_controls(
        request_payload["messages"],
        model,
        bool(request_payload.get("enable_thinking", True)),
    )

    if payload.stream:
        async def event_stream():
            try:
                async for chunk in inference.stream_chat_completion(model.id, {
                    **request_payload,
                    "stream_options": {"include_usage": True},
                }):
                    yield chunk
            except RuntimeError as exc:
                message = str(exc).replace("\\", "\\\\").replace('"', '\\"')
                yield f'data: {{"error": {{"message": "{message}"}}}}\n\n'
                yield "data: [DONE]\n\n"

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    result = await inference.chat_completion(model.id, request_payload)
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model.alias,
        "choices": result.get("choices", []),
        "usage": result.get("usage", {}),
    }
