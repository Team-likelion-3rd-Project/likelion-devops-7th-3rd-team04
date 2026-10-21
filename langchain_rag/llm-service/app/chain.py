"""LangChain 대화 체인: 의도 분류 → 시스템 프롬프트 + 대화 이력 + LLM 호출(app/llm.py).

한 턴의 처리 순서:
  1. intent.py로 예약·결제·취소 의도와 예약 슬롯을 뽑음 (짧은 JSON 호출)
  2. 호출자가 `context`를 넘겼으면 그대로 사용 (테스트용 override), 없으면 retrieval.py로 RAG 검색
  3. 의도에 맞는 지시(되묻기/버튼 안내/로그인 안내)를 시스템 프롬프트에 붙여 답변 생성
"""

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from . import intent, llm, retrieval
from .schemas import ChatMessage

SYSTEM_PROMPT = (
    "You are a helpful assistant for a hotel booking service. "
    "Answer concisely and in the same language the user writes in. "
    "You cannot create, pay for or cancel reservations yourself and must never claim that you did; "
    "the service shows buttons for those actions when appropriate."
)

_prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "{system}"),
        MessagesPlaceholder("history"),
        ("human", "{message}"),
    ]
)


def _chain():
    return _prompt | llm.chat_model()


def _to_langchain_messages(history: list[ChatMessage]) -> list[HumanMessage | AIMessage]:
    converted: list[HumanMessage | AIMessage] = []
    for turn in history:
        if turn.role == "user":
            converted.append(HumanMessage(content=turn.content))
        else:
            converted.append(AIMessage(content=turn.content))
    return converted


async def generate_reply(
    message: str,
    history: list[ChatMessage],
    context: str | None = None,
    authenticated: bool = False,
) -> tuple[str, intent.IntentResult]:
    intent_result = await intent.classify(message, history)

    if context is None:
        context = await retrieval.query_context(message)
    prompt_message = message if context is None else f"{message}\n\nContext:\n{context}"

    hint = intent.reply_hint(intent_result, authenticated)
    system = SYSTEM_PROMPT if hint is None else f"{SYSTEM_PROMPT}\n\n{hint}"

    result = await _chain().ainvoke(
        {
            "system": system,
            "message": prompt_message,
            "history": _to_langchain_messages(history),
        }
    )
    return result.content, intent_result
