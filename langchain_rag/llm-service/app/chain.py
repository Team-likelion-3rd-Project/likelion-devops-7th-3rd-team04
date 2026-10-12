"""LangChain chat chain: prompt template + history + Ollama.

This is the "LLM Service" from CLAUDE.md's Chatbot / AI subsystem section —
it orchestrates one chat turn (prompt assembly, retrieved context, the
Ollama call) behind the HTTP contract in main.py.

RAG retrieval (S3 Vectors) is implemented in `retrieval.py` — this service
does its own lookup now, via `_retrieve_context` below, rather than relying
on the caller (n8n) to supply `context`. A caller-supplied `context` (e.g.
for testing, or a future Neptune-based retriever) still takes priority when
present — see `generate_reply`.
"""

import os

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_ollama import ChatOllama

from . import retrieval
from .schemas import ChatMessage

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")

SYSTEM_PROMPT = (
    "You are a helpful assistant for a hotel booking service. "
    "Answer concisely and in the same language the user writes in."
)

_llm = ChatOllama(base_url=OLLAMA_BASE_URL, model=OLLAMA_MODEL)

_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        MessagesPlaceholder("history"),
        ("human", "{message}"),
    ]
)

_chain = _prompt | _llm


async def _retrieve_context(message: str) -> str | None:
    """Real S3 Vectors RAG lookup (see retrieval.py). Returns None — never
    raises — when retrieval isn't configured or fails, so this service keeps
    answering (without grounding) rather than erroring out."""
    return await retrieval.query_context(message)


def _to_langchain_messages(history: list[ChatMessage]) -> list[HumanMessage | AIMessage]:
    converted: list[HumanMessage | AIMessage] = []
    for turn in history:
        if turn.role == "user":
            converted.append(HumanMessage(content=turn.content))
        else:
            converted.append(AIMessage(content=turn.content))
    return converted


async def generate_reply(
    message: str, history: list[ChatMessage], context: str | None = None
) -> str:
    """Orchestrate one turn: use the caller-supplied context if given, else
    fall back to this service's own RAG retrieval, then call the LLM."""
    if context is None:
        context = await _retrieve_context(message)
    prompt_message = message if context is None else f"{message}\n\nContext:\n{context}"

    result = await _chain.ainvoke(
        {"message": prompt_message, "history": _to_langchain_messages(history)}
    )
    return result.content
