"""RAG 검색: Ollama 임베딩 모델로 질문을 벡터화하고 S3 Vectors 인덱스를 조회합니다.
쓰기 쪽(인덱스 채우기)은 scripts/ingest.py가 담당합니다.

boto3 `s3vectors` 클라이언트 API (boto3==1.43.73 기준 확인 — AWS가 API를 바꾸면 여기부터 확인):
  - put_vectors(vectorBucketName, indexName, vectors=[
        {"key": str, "data": {"float32": [float, ...]}, "metadata": {...}},
    ])
  - query_vectors(vectorBucketName, indexName, topK, queryVector={"float32": [...]},
        returnMetadata=True, returnDistance=True)
    -> {"vectors": [{"key", "distance", "metadata"}], "distanceMetric", "nextToken"}

검색은 best-effort입니다. 설정이 없거나(VECTOR_BUCKET_NAME 미설정) 조회가 실패해도
(네트워크, IAM, throttling 등) 예외 대신 None을 돌려줍니다 — RAG를 못 쓰더라도 500을
내지 않고 근거 없이라도 답변을 이어가기 위함입니다.
"""

import asyncio
import logging

import boto3
from langchain_ollama import OllamaEmbeddings

from . import config

logger = logging.getLogger(__name__)

_embeddings = OllamaEmbeddings(base_url=config.OLLAMA_BASE_URL, model=config.OLLAMA_EMBED_MODEL)

# VECTOR_BUCKET_NAME이 없으면(AWS 없는 로컬 개발) None — 호출부는 이를 "RAG 사용 안 함"으로 취급합니다.
s3vectors_client = (
    boto3.client("s3vectors", region_name=config.AWS_REGION) if config.VECTOR_BUCKET_NAME else None
)


def is_configured() -> bool:
    return s3vectors_client is not None and bool(config.VECTOR_INDEX_NAME)


async def embed(text: str) -> list[float]:
    return await _embeddings.aembed_query(text)


async def query_context(message: str, top_k: int = config.RAG_TOP_K) -> str | None:
    """질문과 가장 가까운 top_k개 문서의 `metadata.text`를 하나의 context 문자열로 합칩니다.
    예외를 던지지 않습니다."""
    if not is_configured():
        return None

    try:
        vector = await embed(message)
        response = await asyncio.to_thread(
            s3vectors_client.query_vectors,
            vectorBucketName=config.VECTOR_BUCKET_NAME,
            indexName=config.VECTOR_INDEX_NAME,
            topK=top_k,
            queryVector={"float32": vector},
            returnMetadata=True,
            returnDistance=True,
        )
    except Exception:
        logger.exception("S3 Vectors 검색 실패 — RAG context 없이 계속합니다")
        return None

    matches = response.get("vectors", [])
    texts = [m["metadata"]["text"] for m in matches if m.get("metadata", {}).get("text")]
    return "\n---\n".join(texts) if texts else None
