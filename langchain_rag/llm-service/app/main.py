"""llm-service HTTP API. n8n 워크플로(../n8n/workflows/chat-orchestration.json)가 호출합니다.

    curl localhost:8001/chat -X POST -H 'Content-Type: application/json' \\
        -d '{"message": "안녕하세요", "history": []}'
"""

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Response

from . import config, llm, retrieval
from .chain import generate_reply
from .schemas import ChatRequest, ChatResponse
from .vector_store import ObjectJsonStore

logger = logging.getLogger(__name__)

app = FastAPI(title="llm-service")

# /chat 의 마지막 성공·실패 — /health 에 상태로만 보여 줍니다(판정에는 쓰지 않음).
_llm_state: dict[str, str | None] = {"lastSuccessAt": None, "lastFailureAt": None, "lastError": None}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vector_store_status() -> dict[str, object]:
    store = retrieval.store()
    status: dict[str, object] = {"type": config.VECTOR_STORE, "configured": store.is_configured()}
    if isinstance(store, ObjectJsonStore):
        status["documents"] = store.loaded_documents()
    return status


@app.get("/health")
async def health(response: Response) -> dict[str, object]:
    """K8s startup·readiness·liveness probe 가 부릅니다. 외부(Vertex·벡터 스토어)는 호출하지 않습니다.

    - 503: LLM_PROVIDER·VECTOR_STORE 설정이 잘못돼 어떤 요청도 처리할 수 없을 때 — 배포 직후 startup probe에서 걸립니다.
    - 200: 그 외. LLM 호출 실패나 RAG 미설정은 파드를 재시작해도 낫지 않으므로 상태로만 보여 줍니다
      (backend libs/common HealthController 와 같은 원칙).
    """
    try:
        llm_status = {"provider": llm.provider(), **_llm_state}
        vector_status = _vector_store_status()
    except ValueError as exc:
        response.status_code = 503
        return {"status": "error", "error": str(exc)}
    return {"status": "ok", "llm": llm_status, "vectorStore": vector_status}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    # 한 턴 전체 마감 — n8n·chat-bot-service(50초)보다 먼저 끊어 사용자가 앞단 504 대신 실패 응답을 받게 합니다.
    try:
        async with asyncio.timeout(config.CHAT_REQUEST_TIMEOUT_SECONDS):
            reply, intent_result = await generate_reply(
                request.message, request.history, request.context, request.authenticated
            )
    except TimeoutError:
        _llm_state.update(lastFailureAt=_now(), lastError="TimeoutError")
        logger.error("/chat 이 %s초 안에 끝나지 않았습니다", config.CHAT_REQUEST_TIMEOUT_SECONDS)
        raise HTTPException(status_code=504, detail="LLM response timed out") from None
    except Exception as exc:
        _llm_state.update(lastFailureAt=_now(), lastError=type(exc).__name__)
        raise
    _llm_state.update(lastSuccessAt=_now())

    # 비로그인이면 액션은 내보내지 않습니다(intent만 전달 — chat-bot-service가 로그인 안내로 바꿈).
    # 실제 차단은 chat-bot-service가 하며, 여기는 이중 방어입니다.
    action = intent_result.action if request.authenticated else None
    return ChatResponse(reply=reply, intent=intent_result.intent, action=action)
