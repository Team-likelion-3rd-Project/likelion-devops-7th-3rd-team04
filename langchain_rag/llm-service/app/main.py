"""llm-service HTTP API. n8n 워크플로(../n8n/workflows/chat-orchestration.json)가 호출합니다.

    curl localhost:8001/chat -X POST -H 'Content-Type: application/json' \\
        -d '{"message": "안녕하세요", "history": []}'
"""

from fastapi import FastAPI

from .chain import generate_reply
from .schemas import ChatRequest, ChatResponse

app = FastAPI(title="llm-service")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    reply, intent_result = await generate_reply(
        request.message, request.history, request.context, request.authenticated
    )
    # 비로그인이면 액션은 내보내지 않습니다(intent만 전달 — chat-bot-service가 로그인 안내로 바꿈).
    # 실제 차단은 chat-bot-service가 하며, 여기는 이중 방어입니다.
    action = intent_result.action if request.authenticated else None
    return ChatResponse(reply=reply, intent=intent_result.intent, action=action)
