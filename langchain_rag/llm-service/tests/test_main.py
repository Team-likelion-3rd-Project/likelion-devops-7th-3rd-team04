import asyncio

import pytest
from fastapi.testclient import TestClient

from app import config, llm, main, retrieval
from app.intent import NO_INTENT


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    # /health 는 retrieval.store() 캐시와 main 의 상태를 읽으므로 테스트마다 새로 시작합니다.
    monkeypatch.setattr(config, "LLM_PROVIDER", "vertex")
    monkeypatch.setattr(config, "VECTOR_STORE", "none")
    monkeypatch.setattr(main, "_llm_state", {"lastSuccessAt": None, "lastFailureAt": None, "lastError": None})
    retrieval.store.cache_clear()
    yield
    retrieval.store.cache_clear()
    llm.chat_model.cache_clear()


client = TestClient(main.app)


def test_health_reports_status_without_calling_llm():
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "llm": {"provider": "vertex", "lastSuccessAt": None, "lastFailureAt": None, "lastError": None},
        "vectorStore": {"type": "none", "configured": False},
    }
    assert llm.chat_model.cache_info().currsize == 0


def test_health_shows_documents_for_object_store(monkeypatch):
    monkeypatch.setattr(config, "VECTOR_STORE", "object")
    monkeypatch.setattr(config, "VECTOR_OBJECT_BUCKET", "rag-index")

    # 아직 인덱스를 읽지 않았으면 null — /health 가 저장소를 조회하지 않음
    assert client.get("/health").json()["vectorStore"] == {"type": "object", "configured": True, "documents": None}


@pytest.mark.parametrize("name,value", [("LLM_PROVIDER", "openai"), ("VECTOR_STORE", "pinecone")])
def test_health_fails_on_invalid_config(monkeypatch, name, value):
    monkeypatch.setattr(config, name, value)

    response = client.get("/health")

    assert response.status_code == 503
    assert response.json()["status"] == "error"


def test_chat_records_last_success(monkeypatch):
    async def reply(*args):
        return "안녕하세요", NO_INTENT

    monkeypatch.setattr(main, "generate_reply", reply)

    assert client.post("/chat", json={"message": "안녕"}).status_code == 200
    llm_status = client.get("/health").json()["llm"]
    assert llm_status["lastSuccessAt"] is not None
    assert llm_status["lastFailureAt"] is None


def test_chat_returns_504_after_request_deadline(monkeypatch):
    async def slow_reply(*args):
        await asyncio.sleep(5)

    monkeypatch.setattr(main, "generate_reply", slow_reply)
    monkeypatch.setattr(config, "CHAT_REQUEST_TIMEOUT_SECONDS", 0.05)

    assert client.post("/chat", json={"message": "안녕"}).status_code == 504
    llm_status = client.get("/health").json()["llm"]
    assert llm_status["lastError"] == "TimeoutError"
    assert llm_status["lastFailureAt"] is not None


def test_chat_records_failure_and_health_stays_ok(monkeypatch):
    async def broken_reply(*args):
        raise RuntimeError("vertex down")

    monkeypatch.setattr(main, "generate_reply", broken_reply)

    assert TestClient(main.app, raise_server_exceptions=False).post("/chat", json={"message": "안녕"}).status_code == 500
    response = client.get("/health")
    # LLM 장애로 파드를 재시작해 봐야 낫지 않으므로 200 을 유지하고 상태로만 보여 줍니다
    assert response.status_code == 200
    assert response.json()["llm"]["lastError"] == "RuntimeError"
