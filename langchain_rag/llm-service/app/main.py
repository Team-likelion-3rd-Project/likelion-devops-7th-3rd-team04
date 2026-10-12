"""FastAPI HTTP API in front of the self-hosted Ollama node.

This is the "LLM Service" described in CLAUDE.md's Chatbot / AI subsystem
section: the HTTP endpoint that orchestrates one chat turn (prompt assembly
+ Ollama call, with a retrieval hook for future RAG). It's what n8n will
call once the n8n workflow exists; until then it can be exercised directly:

    curl localhost:8000/chat -X POST -H 'Content-Type: application/json' \\
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
    reply = await generate_reply(request.message, request.history, request.context)
    return ChatResponse(reply=reply)
