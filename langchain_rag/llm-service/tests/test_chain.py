import asyncio

import pytest
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableLambda

from app import chain, intent, llm, retrieval
from app.intent import NO_INTENT


@pytest.fixture
def prompts(monkeypatch):
    """LLM 대신 받은 프롬프트를 기록하고 고정 답변을 돌려줍니다."""
    seen = []

    def fake_model(prompt_value):
        seen.append(prompt_value.to_messages())
        return AIMessage(content="답변")

    monkeypatch.setattr(llm, "chat_model", lambda json_mode=False: RunnableLambda(fake_model))
    return seen


def test_intent_and_retrieval_run_concurrently(monkeypatch, prompts):
    # 서로 상대가 시작했다는 신호를 기다립니다 — 순서대로 실행하면 1초 안에 끝나지 않아 실패합니다.
    intent_started, retrieval_started = asyncio.Event(), asyncio.Event()

    async def classify(message, history):
        intent_started.set()
        await asyncio.wait_for(retrieval_started.wait(), 1)
        return NO_INTENT

    async def query_context(message):
        retrieval_started.set()
        await asyncio.wait_for(intent_started.wait(), 1)
        return "체크인은 오후 3시입니다."

    monkeypatch.setattr(intent, "classify", classify)
    monkeypatch.setattr(retrieval, "query_context", query_context)

    reply, result = asyncio.run(chain.generate_reply("체크인 몇 시예요?", []))

    assert reply == "답변"
    assert result == NO_INTENT


def test_context_goes_to_system_prompt_and_user_message_stays_raw(monkeypatch, prompts):
    async def classify(message, history):
        return NO_INTENT

    async def query_context(message):
        return "체크인은 오후 3시입니다."

    monkeypatch.setattr(intent, "classify", classify)
    monkeypatch.setattr(retrieval, "query_context", query_context)

    asyncio.run(chain.generate_reply("체크인 몇 시예요?", []))

    system, human = prompts[0]
    assert isinstance(system, SystemMessage) and isinstance(human, HumanMessage)
    assert "<context>\n체크인은 오후 3시입니다.\n</context>" in system.content
    assert "only from the <context> block" in system.content
    assert human.content == "체크인 몇 시예요?"


def test_missing_context_is_stated_explicitly(monkeypatch, prompts):
    async def classify(message, history):
        return NO_INTENT

    async def query_context(message):
        return None

    monkeypatch.setattr(intent, "classify", classify)
    monkeypatch.setattr(retrieval, "query_context", query_context)

    asyncio.run(chain.generate_reply("주차 되나요?", []))

    assert "No reference documents were found" in prompts[0][0].content


def test_explicit_context_skips_retrieval(monkeypatch, prompts):
    async def classify(message, history):
        return NO_INTENT

    async def query_context(message):
        raise AssertionError("context를 직접 넘기면 검색하지 않아야 합니다")

    monkeypatch.setattr(intent, "classify", classify)
    monkeypatch.setattr(retrieval, "query_context", query_context)

    asyncio.run(chain.generate_reply("반복해줘", [], context="TEST-CONTEXT-12345"))

    assert "TEST-CONTEXT-12345" in prompts[0][0].content
