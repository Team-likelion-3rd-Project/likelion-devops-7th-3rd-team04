"""RAG 검색: 질문을 임베딩(app/llm.py)하고 벡터 스토어(app/vector_store.py)에서 가까운 문서를 찾습니다.
쓰기 쪽(인덱스 채우기)은 scripts/ingest.py가 담당합니다.

검색은 best-effort입니다. 스토어가 설정되지 않았거나 조회가 실패해도(네트워크, 권한, throttling 등)
예외 대신 None을 돌려줍니다 — RAG를 못 쓰더라도 500을 내지 않고 근거 없이라도 답변을 이어가기 위함입니다.
"""

import asyncio
import logging
from functools import cache

from . import config, llm
from .vector_store import VectorStore, create_store

logger = logging.getLogger(__name__)


@cache
def store() -> VectorStore:
    return create_store()


def is_configured() -> bool:
    return store().is_configured()


async def embed_query(text: str) -> list[float]:
    return await llm.embeddings().aembed_query(text)


async def embed_documents(texts: list[str]) -> list[list[float]]:
    # Vertex 임베딩은 질문(RETRIEVAL_QUERY)과 문서(RETRIEVAL_DOCUMENT)를 구분해 임베딩합니다.
    return await llm.embeddings().aembed_documents(texts)


async def query_context(message: str, top_k: int = config.RAG_TOP_K) -> str | None:
    """질문과 가장 가까운 top_k개 문서의 원문을 하나의 context 문자열로 합칩니다. 예외를 던지지 않습니다."""
    try:
        if not is_configured():
            return None
        vector = await embed_query(message)
        texts = await asyncio.to_thread(store().query, vector, top_k)
    except Exception:
        logger.exception("RAG 검색 실패 — context 없이 계속합니다")
        return None
    return "\n---\n".join(texts) if texts else None
