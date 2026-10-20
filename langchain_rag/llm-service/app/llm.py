"""LLM·임베딩 공급자 팩토리. LLM_PROVIDER로 Ollama(로컬 compose)와 Vertex AI(dev·prod)를 고릅니다.

클라이언트는 처음 쓰일 때 만듭니다 — 자격 증명이나 Ollama가 없어도 앱 기동과 /health는 되도록
(CI 이미지 smoke 테스트, Pod 기동 순서 문제 대비).
"""

import json
from functools import cache

from langchain_core.embeddings import Embeddings
from langchain_core.language_models.chat_models import BaseChatModel

from . import config

PROVIDERS = ("ollama", "vertex")


def provider() -> str:
    if config.LLM_PROVIDER not in PROVIDERS:
        raise ValueError(f"LLM_PROVIDER must be one of {PROVIDERS}, got {config.LLM_PROVIDER!r}")
    return config.LLM_PROVIDER


def embedding_model_name() -> str:
    """벡터 스토어에 함께 기록해 두는 임베딩 모델 식별자. 모델이 바뀌면 다시 ingest해야 합니다."""
    if provider() == "vertex":
        return f"vertex:{config.VERTEX_EMBED_MODEL}"
    return f"ollama:{config.OLLAMA_EMBED_MODEL}"


def _vertex_credentials():
    if not config.GCP_SA_KEY_JSON:
        return None  # ADC (로컬 gcloud auth application-default login 등)
    from google.oauth2 import service_account

    return service_account.Credentials.from_service_account_info(
        json.loads(config.GCP_SA_KEY_JSON),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )


@cache
def chat_model(json_mode: bool = False) -> BaseChatModel:
    """json_mode=True는 의도 분류용: JSON만 출력하고 temperature 0."""
    if provider() == "vertex":
        from langchain_google_vertexai import ChatVertexAI

        options = {"temperature": 0, "response_mime_type": "application/json"} if json_mode else {}
        return ChatVertexAI(
            model=config.VERTEX_CHAT_MODEL,
            project=config.GCP_PROJECT_ID,
            location=config.VERTEX_CHAT_LOCATION,
            credentials=_vertex_credentials(),
            # gemini-2.5는 기본으로 thinking 토큰을 씁니다. 짧은 상담 답변에는 필요 없어 꺼서 지연·비용을 줄입니다.
            thinking_budget=0,
            **options,
        )

    from langchain_ollama import ChatOllama

    options = {"format": "json", "temperature": 0} if json_mode else {}
    return ChatOllama(base_url=config.OLLAMA_BASE_URL, model=config.OLLAMA_MODEL, **options)


@cache
def embeddings() -> Embeddings:
    if provider() == "vertex":
        from langchain_google_vertexai import VertexAIEmbeddings

        return VertexAIEmbeddings(
            model_name=config.VERTEX_EMBED_MODEL,
            project=config.GCP_PROJECT_ID,
            location=config.GCP_LOCATION,
            credentials=_vertex_credentials(),
        )

    from langchain_ollama import OllamaEmbeddings

    return OllamaEmbeddings(base_url=config.OLLAMA_BASE_URL, model=config.OLLAMA_EMBED_MODEL)
