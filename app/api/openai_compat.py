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
from app.utils.schemas import OpenAIChatRequest, normalize_message_content

router = APIRouter(prefix="/v1", tags=["openai"])


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
    if "enable_thinking" not in request_payload:
        request_payload["enable_thinking"] = model.thinking_enabled
    request_payload["messages"] = [
        {
            key: value
            for key, value in message.model_dump(exclude_none=True).items()
            if key != "content" or value != ""
        }
        | {"content": normalize_message_content(message.content)}
        for message in payload.messages
    ]

    # When thinking is disabled, inject /no_think into the system message so
    # that models with a built-in thinking template (e.g. Qwen3) reliably skip
    # the thinking phase.  Some llama-server builds ignore the enable_thinking
    # API parameter, but all compliant Qwen3 builds respect this control token.
    if not request_payload.get("enable_thinking", True):
        msgs = request_payload["messages"]
        if msgs and msgs[0].get("role") == "system":
            existing = msgs[0].get("content") or ""
            if "/no_think" not in existing:
                request_payload["messages"] = [
                    {**msgs[0], "content": "/no_think\n" + existing if existing else "/no_think"},
                    *msgs[1:],
                ]
        else:
            request_payload["messages"] = [{"role": "system", "content": "/no_think"}, *msgs]

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
