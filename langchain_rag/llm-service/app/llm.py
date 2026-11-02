"""LLM·임베딩 공급자 팩토리. LLM_PROVIDER로 Ollama(로컬 compose)와 Vertex AI(dev·prod)를 고릅니다.

클라이언트는 처음 쓰일 때 만듭니다 — 자격 증명이나 Ollama가 없어도 앱 기동과 /health는 되도록
(CI 이미지 smoke 테스트, Pod 기동 순서 문제 대비).
"""

import json
import os
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


def _aws_federated_credentials():
    """파드의 AWS 자격 증명 → GCP STS → 서비스 계정 impersonate.

    google-auth 기본 AWS 경로는 환경 변수와 IMDS만 읽어 EKS Pod Identity를 쓰지 못하므로 boto3로 읽어 넘깁니다.
    """
    import boto3
    from google.auth import aws

    class Boto3Supplier(aws.AwsSecurityCredentialsSupplier):
        def __init__(self):
            self._session = boto3.Session()

        def get_aws_security_credentials(self, context, request):
            # botocore가 만료 전에 갱신하므로 매번 읽습니다.
            frozen = self._session.get_credentials().get_frozen_credentials()
            return aws.AwsSecurityCredentials(frozen.access_key, frozen.secret_key, frozen.token)

        def get_aws_region(self, context, request):
            # boto3 세션은 AWS_REGION을 읽지 않습니다(AWS_DEFAULT_REGION · 설정 파일만). 파드에는 AWS_REGION이 있습니다.
            return os.getenv("AWS_REGION") or self._session.region_name

    return aws.Credentials(
        audience=config.GCP_WIF_AWS_AUDIENCE,
        subject_token_type="urn:ietf:params:aws:token-type:aws4_request",
        token_url="https://sts.googleapis.com/v1/token",
        service_account_impersonation_url=(
            "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/"
            f"{config.GCP_WIF_SERVICE_ACCOUNT_EMAIL}:generateAccessToken"
        ),
        aws_security_credentials_supplier=Boto3Supplier(),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )


def _vertex_credentials():
    if config.GCP_SA_KEY_JSON:
        from google.oauth2 import service_account

        return service_account.Credentials.from_service_account_info(
            json.loads(config.GCP_SA_KEY_JSON),
            scopes=["https://www.googleapis.com/auth/cloud-platform"],
        )
    if config.GCP_WIF_AWS_AUDIENCE:
        return _aws_federated_credentials()
    return None  # ADC (로컬 gcloud auth application-default login, kubeadm 운영의 external_account 파일 등)


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
