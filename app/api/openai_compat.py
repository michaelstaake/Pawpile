import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.deps import require_api_access
from app.core.db import get_db
from app.core.inference_manager import InferenceManager
from app.models.model_config import ModelConfig
from app.models.user import User
from app.utils.schemas import OpenAIChatRequest

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
            }
            for m in models
        ],
    }


@router.post("/chat/completions")
async def v1_chat_completions(payload: OpenAIChatRequest, _: User = Depends(require_api_access), db: Session = Depends(get_db)):
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]
    model = (
        db.query(ModelConfig)
        .filter(ModelConfig.alias == payload.model, ModelConfig.activated.is_(True))
        .first()
    )
    if not model:
        raise HTTPException(status_code=404, detail="Model not found or not active")

    request_payload = {
        "model": payload.model,
        "messages": [m.model_dump() for m in payload.messages],
        "stream": False,
        "temperature": payload.temperature,
        "max_tokens": payload.max_tokens,
    }

    if payload.stream:
        async def event_stream():
            result = await inference.chat_completion(model.id, request_payload)
            text = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            chunk_id = f"chatcmpl-{uuid.uuid4().hex}"
            first = {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(first)}\n\n"
            for token in text.split(" "):
                data = {
                    "id": chunk_id,
                    "object": "chat.completion.chunk",
                    "choices": [{"index": 0, "delta": {"content": token + " "}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(data)}\n\n"
            last = {
                "id": chunk_id,
                "object": "chat.completion.chunk",
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            }
            yield f"data: {json.dumps(last)}\n\n"
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
