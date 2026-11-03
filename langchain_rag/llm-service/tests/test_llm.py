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

    assert TestClient(app).get("/health").json()["status"] == "ok"
    assert llm.chat_model.cache_info().currsize == 0
    assert llm.embeddings.cache_info().currsize == 0


def test_ollama_provider(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "ollama")
    from langchain_ollama import ChatOllama, OllamaEmbeddings

    chat = llm.chat_model(json_mode=True)
    assert isinstance(chat, ChatOllama)
    assert chat.format == "json" and chat.temperature == 0
    assert chat.client_kwargs == {"timeout": config.LLM_TIMEOUT_SECONDS}
    embeddings = llm.embeddings()
    assert isinstance(embeddings, OllamaEmbeddings)
    assert embeddings.client_kwargs == {"timeout": config.LLM_TIMEOUT_SECONDS}
    assert llm.embedding_model_name() == f"ollama:{config.OLLAMA_EMBED_MODEL}"


def test_vertex_provider_uses_json_mode_and_disables_thinking(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "vertex")
    monkeypatch.setattr(config, "GCP_PROJECT_ID", "test-project")
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    from langchain_google_vertexai import ChatVertexAI

    chat = llm.chat_model(json_mode=True).bound
    assert isinstance(chat, ChatVertexAI)
    assert chat.response_mime_type == "application/json"
    assert chat.thinking_budget == 0
    assert chat.location == config.VERTEX_CHAT_LOCATION
    assert llm.embedding_model_name() == f"vertex:{config.VERTEX_EMBED_MODEL}"


def test_vertex_provider_sets_timeout_and_retries(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "vertex")
    monkeypatch.setattr(config, "GCP_PROJECT_ID", "test-project")
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    monkeypatch.setattr(config, "LLM_TIMEOUT_SECONDS", 15.0)
    monkeypatch.setattr(config, "LLM_MAX_RETRIES", 2)

    chat = llm.chat_model()
    # 시도 1회 타임아웃은 호출 인자로 gRPC 요청에 전달되고, max_retries 는 총 시도 횟수(재시도 2회 + 첫 시도)
    assert chat.kwargs == {"timeout": 15.0}
    assert chat.bound.max_retries == 3

    # VertexAIEmbeddings 는 만들 때 모델을 조회(인증 필요)하므로 인자만 확인합니다.
    import langchain_google_vertexai

    captured = {}
    monkeypatch.setattr(langchain_google_vertexai, "VertexAIEmbeddings", lambda **kwargs: captured.update(kwargs))
    llm.embeddings()
    assert captured["max_retries"] == 3


def test_vertex_credentials_default_to_adc(monkeypatch):
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    monkeypatch.setattr(config, "GCP_WIF_AWS_AUDIENCE", None)

    assert llm._vertex_credentials() is None


def test_vertex_credentials_prefer_sa_key(monkeypatch):
    from google.oauth2 import service_account

    sentinel = object()
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", '{"type": "service_account"}')
    monkeypatch.setattr(config, "GCP_WIF_AWS_AUDIENCE", "//iam.googleapis.com/test")
    monkeypatch.setattr(
        service_account.Credentials, "from_service_account_info", lambda info, scopes: sentinel
    )

    assert llm._vertex_credentials() is sentinel


def test_vertex_credentials_use_aws_supplier(monkeypatch):
    from botocore.credentials import Credentials
    from google.auth import aws

    # 파드 환경과 같게 AWS_REGION 만 둡니다 (boto3 세션의 region_name 은 이 값을 읽지 않음).
    monkeypatch.setenv("AWS_REGION", "us-east-1")
    monkeypatch.delenv("AWS_DEFAULT_REGION", raising=False)
    monkeypatch.setattr(config, "GCP_SA_KEY_JSON", None)
    monkeypatch.setattr(config, "GCP_WIF_AWS_AUDIENCE", "//iam.googleapis.com/test")
    monkeypatch.setattr(config, "GCP_WIF_SERVICE_ACCOUNT_EMAIL", "sa@example.iam.gserviceaccount.com")

    creds = llm._vertex_credentials()
    assert isinstance(creds, aws.Credentials)

    supplier = creds._aws_security_credentials_supplier
    monkeypatch.setattr(
        supplier._session, "get_credentials", lambda: Credentials("key", "secret", "token")
    )
    got = supplier.get_aws_security_credentials(None, None)
    assert (got.access_key_id, got.secret_access_key, got.session_token) == ("key", "secret", "token")
    assert supplier.get_aws_region(None, None) == "us-east-1"


def test_unknown_provider_is_rejected(monkeypatch):
    monkeypatch.setattr(config, "LLM_PROVIDER", "openai")
    with pytest.raises(ValueError):
        llm.chat_model()
