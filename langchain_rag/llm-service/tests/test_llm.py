import pytest

from app import config, llm


@pytest.fixture(autouse=True)
def clear_cache():
    llm.chat_model.cache_clear()
    llm.embeddings.cache_clear()
    yield
    llm.chat_model.cache_clear()
    llm.embeddings.cache_clear()


def test_importing_main_does_not_create_clients(monkeypatch):
    # 자격 증명 없이도 앱이 뜨고 /health가 응답해야 합니다(CI smoke 테스트).
    monkeypatch.setattr(config, "LLM_PROVIDER", "vertex")
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/health").json() == {"status": "ok"}
    assert llm.chat_model.cache_info().currsize == 0


def test_ollama_provider(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "ollama")
    from langchain_ollama import ChatOllama, OllamaEmbeddings

    chat = llm.chat_model(json_mode=True)
    assert isinstance(chat, ChatOllama)
    assert chat.format == "json" and chat.temperature == 0
    assert isinstance(llm.embeddings(), OllamaEmbeddings)
    assert llm.embedding_model_name() == f"ollama:{config.OLLAMA_EMBED_MODEL}"


def test_vertex_provider_uses_json_mode_and_disables_thinking(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "vertex")
    monkeypatch.setattr(config, "GCP_PROJECT_ID", "test-project")
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    from langchain_google_vertexai import ChatVertexAI

    chat = llm.chat_model(json_mode=True)
    assert isinstance(chat, ChatVertexAI)
    assert chat.response_mime_type == "application/json"
    assert chat.thinking_budget == 0
    assert chat.location == config.VERTEX_CHAT_LOCATION
    assert llm.embedding_model_name() == f"vertex:{config.VERTEX_EMBED_MODEL}"


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "openai")
    with pytest.raises(ValueError):
        llm.chat_model()
