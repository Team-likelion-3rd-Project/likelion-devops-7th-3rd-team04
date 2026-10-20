#!/usr/bin/env python3
"""RAG 인덱스 적재: app/corpus.py의 문서를 임베딩(app/llm.py)해 벡터 스토어(app/vector_store.py)에 씁니다.
문서마다 key가 고정이라 다시 실행해도 중복되지 않습니다(object 스토어는 파일 전체를 새로 씀).

필요한 권한:
  - VECTOR_STORE=s3vectors: S3 Vectors 버킷/인덱스의 `s3vectors:PutVectors`
  - VECTOR_STORE=object: 버킷(VECTOR_OBJECT_BUCKET)에 쓰기 권한이 있는 접근 키

사용법:
  # 로컬
  cd langchain_rag/llm-service
  python -m scripts.ingest

  # docker compose로 띄운 llm-service 컨테이너 안에서
  docker compose -f langchain_rag/docker-compose.yml exec llm-service python -m scripts.ingest

  # 온프레미스 dev 클러스터
  kubectl -n backend exec deploy/llm-service -- python -m scripts.ingest
"""

import asyncio
import logging

from app import config, llm, retrieval
from app.corpus import DOCUMENTS
from app.vector_store import VectorItem

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    if not retrieval.is_configured():
        raise SystemExit(
            f"VECTOR_STORE={config.VECTOR_STORE} 설정이 비어 있습니다(.env.example 참고) — "
            "s3vectors는 VECTOR_BUCKET_NAME/VECTOR_INDEX_NAME, object는 VECTOR_OBJECT_BUCKET이 필요합니다."
        )

    vectors = await retrieval.embed_documents([doc["text"] for doc in DOCUMENTS])
    items: list[VectorItem] = [
        {"key": doc["id"], "text": doc["text"], "metadata": doc["metadata"], "vector": vector}
        for doc, vector in zip(DOCUMENTS, vectors)
    ]
    for item in items:
        logger.info("embedded %s (%d dims)", item["key"], len(item["vector"]))

    retrieval.store().replace_all(items)
    logger.info(
        "%d documents indexed into VECTOR_STORE=%s with %s", len(items), config.VECTOR_STORE, llm.embedding_model_name()
    )


if __name__ == "__main__":
    asyncio.run(main())
