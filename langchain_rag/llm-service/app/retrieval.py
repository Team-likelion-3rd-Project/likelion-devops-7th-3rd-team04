"""RAG 검색: 질문을 임베딩(app/llm.py)하고 벡터 스토어(app/vector_store.py)에서 가까운 문서를 찾습니다.
쓰기 쪽(인덱스 채우기)은 scripts/ingest.py가 담당합니다.

정확도를 위해 두 가지를 거릅니다.
  - 지점 필터: 질문에 지점(corpus.HOTEL_ALIASES)이 나오면 그 지점 + 공통 문서에서만 찾습니다. LLM을 부르지 않는
    키워드 매칭이라 의도 분류와 동시에 돌 수 있습니다(chain.py).
  - 유사도 임계값: RAG_MIN_SCORE 미만 문서는 버립니다 — 인사처럼 관련 문서가 없는 질문에 엉뚱한 근거가 붙지 않게.

검색은 best-effort입니다. 스토어가 설정되지 않았거나 조회가 실패해도(네트워크, 권한, throttling 등)
예외 대신 None을 돌려줍니다 — RAG를 못 쓰더라도 500을 내지 않고 근거 없이라도 답변을 이어가기 위함입니다.
"""

import asyncio
import logging
from functools import cache

from . import config, llm
from .corpus import HOTEL_ALIASES
from .vector_store import SearchHit, VectorStore, create_store

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


def detect_hotels(message: str) -> list[str] | None:
    """질문에 나온 지점 slug 목록. 없으면 None(필터 없이 전체 검색)."""
    hotels = [slug for slug, aliases in HOTEL_ALIASES.items() if any(alias in message for alias in aliases)]
    return hotels or None


def _relevant(hits: list[SearchHit], min_score: float) -> list[SearchHit]:
    for hit in hits:
        logger.debug("RAG 후보 %s score=%.3f", hit.key, hit.score)
    return [hit for hit in hits if hit.score >= min_score]


async def query_context(message: str, top_k: int = config.RAG_TOP_K) -> str | None:
    """질문과 가까운 문서(최대 top_k개, RAG_MIN_SCORE 이상)의 원문을 하나의 context 문자열로 합칩니다.
    예외를 던지지 않습니다.

    임베딩(재시도 포함)과 조회를 합쳐 LLM_TIMEOUT_SECONDS 안에 끝나지 않으면 근거 없이 진행합니다 —
    Vertex 임베딩 SDK에는 호출 타임아웃이 없어 여기서 제한합니다.
    """
    try:
        if not is_configured():
            return None
        async with asyncio.timeout(config.LLM_TIMEOUT_SECONDS):
            vector = await embed_query(message)
            hits = await asyncio.to_thread(store().query, vector, top_k, detect_hotels(message))

    except Exception:
        logger.exception("RAG 검색 실패 — context 없이 계속합니다")
        return None
    texts = [hit.text for hit in _relevant(hits, config.RAG_MIN_SCORE)]
    return "\n---\n".join(texts) if texts else None
