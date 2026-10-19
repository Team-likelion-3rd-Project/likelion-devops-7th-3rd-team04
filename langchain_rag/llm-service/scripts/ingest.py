#!/usr/bin/env python3
"""RAG 인덱스 적재: app/corpus.py의 문서를 Ollama 임베딩 모델로 벡터화해 S3 Vectors
인덱스에 put_vectors로 씁니다. 문서마다 key가 고정이라 다시 실행해도 중복 없이 덮어씁니다.

S3 Vectors 버킷/인덱스에 접근 가능한 AWS 자격 증명과, 쓰기 작업이므로
`s3vectors:PutVectors` 권한이 필요합니다.

사용법:
  # 로컬 (AWS 자격 증명을 환경변수로 준비한 상태에서)
  cd langchain_rag/llm-service
  python -m scripts.ingest

  # docker compose로 띄운 llm-service 컨테이너 안에서
  docker compose -f langchain_rag/docker-compose.yml exec llm-service python -m scripts.ingest
"""

import asyncio
import logging

from app import config, retrieval
from app.corpus import DOCUMENTS

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    if not retrieval.is_configured():
        raise SystemExit(
            "VECTOR_BUCKET_NAME and VECTOR_INDEX_NAME must be set (see .env.example) "
            "before ingestion can run."
        )

    vectors = []
    for doc in DOCUMENTS:
        vector = await retrieval.embed(doc["text"])
        vectors.append(
            {
                "key": doc["id"],
                "data": {"float32": vector},
                # 원문을 metadata에 같이 실어 query_context()가 추가 조회 없이 바로 돌려줄 수 있게 합니다.
                "metadata": {"text": doc["text"], **doc["metadata"]},
            }
        )
        logger.info("embedded %s (%d dims)", doc["id"], len(vector))

    retrieval.s3vectors_client.put_vectors(
        vectorBucketName=config.VECTOR_BUCKET_NAME,
        indexName=config.VECTOR_INDEX_NAME,
        vectors=vectors,
    )
    logger.info(
        "put_vectors: %d documents indexed into %s/%s",
        len(vectors),
        config.VECTOR_BUCKET_NAME,
        config.VECTOR_INDEX_NAME,
    )


if __name__ == "__main__":
    asyncio.run(main())
