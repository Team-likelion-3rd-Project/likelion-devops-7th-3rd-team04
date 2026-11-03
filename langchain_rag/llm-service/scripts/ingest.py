#!/usr/bin/env python3
"""RAG 인덱스 적재: app/corpus.py의 문서를 임베딩(app/llm.py)해 벡터 스토어(app/vector_store.py)에 씁니다.
적재 후 인덱스는 corpus와 정확히 같아집니다 — 같은 key는 덮어쓰고, corpus에서 사라진 문서는 지웁니다
(s3vectors는 넣은 뒤 list_vectors로 비교해 delete_vectors, object 스토어는 파일 전체를 새로 씀).

필요한 권한:
  - VECTOR_STORE=s3vectors: S3 Vectors 인덱스의 `s3vectors:PutVectors` · `ListVectors` · `DeleteVectors`
    (prod 는 Terraform 51-pod-roles 의 llm-ingest Role)
  - VECTOR_STORE=object: 버킷(VECTOR_OBJECT_BUCKET)에 쓰기 권한이 있는 접근 키

사용법:
  # 로컬
  cd langchain_rag/llm-service
  python -m scripts.ingest

  # docker compose로 띄운 llm-service 컨테이너 안에서
  docker compose -f langchain_rag/docker-compose.yml exec llm-service python -m scripts.ingest

  # 클러스터 — dev·prod 모두 배포 때 backend 차트의 llm-ingest Job 이 실행합니다. 수동으로 다시 돌릴 때만:
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
