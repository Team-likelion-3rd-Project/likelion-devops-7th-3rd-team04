"""LangChain 대화 체인: 시스템 프롬프트 + 대화 이력 + Ollama 호출.

한 턴의 처리 순서:
  1. 호출자가 `context`를 넘겼으면 그대로 사용 (테스트용 override)
  2. 없으면 retrieval.py로 S3 Vectors RAG 검색
  3. 검색 결과가 없거나 실패하면 근거 없이(ungrounded) 답변
"""

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_ollama import ChatOllama

from . import config, retrieval
from .schemas import ChatMessage

SYSTEM_PROMPT = (
    "You are a helpful assistant for a hotel booking service. "
    "Answer concisely and in the same language the user writes in."
)

_llm = ChatOllama(base_url=config.OLLAMA_BASE_URL, model=config.OLLAMA_MODEL)

_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        MessagesPlaceholder("history"),
        ("human", "{message}"),
    ]
)

_chain = _prompt | _llm


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
    if context is None:
        context = await retrieval.query_context(message)
    prompt_message = message if context is None else f"{message}\n\nContext:\n{context}"

    result = await _chain.ainvoke(
        {"message": prompt_message, "history": _to_langchain_messages(history)}
    )
    return result.content
