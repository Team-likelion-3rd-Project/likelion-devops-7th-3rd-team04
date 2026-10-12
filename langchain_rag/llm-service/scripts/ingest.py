#!/usr/bin/env python3
"""One-time (idempotent) RAG ingestion: embeds `app/corpus.py`'s documents
with the self-hosted Ollama embedding model and writes them into the S3
Vectors index via `put_vectors`. Re-running is safe — `key` is stable per
document, so this upserts rather than duplicates.

Needs AWS credentials able to reach the real S3 Vectors bucket/index
(infra/terraform/modules/ai_data) — and, since this writes, the
`s3vectors:PutVectors` IAM permission specifically (a separate Terraform
change from the read-only `GetVectors`/`QueryVectors` the chatbot role has
today — see the plan doc's Terraform dependency notes).

Usage:
  # Locally, with your own AWS credentials on the environment:
  cd langchain_rag/llm-service
  source /mnt/d/Desktop/AWS/aws-mfa.sh <profile> <otp>   # or any AWS_* creds
  python -m scripts.ingest

  # In-cluster, using the llm-service pod's own EKS Pod Identity:
  kubectl exec -n langchain deploy/llm-service -- python -m scripts.ingest
"""

import asyncio
import logging

from app.corpus import DOCUMENTS
from app.retrieval import VECTOR_BUCKET_NAME, VECTOR_INDEX_NAME, embed, s3vectors_client

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def main() -> None:
    if s3vectors_client is None or not VECTOR_INDEX_NAME:
        raise SystemExit(
            "VECTOR_BUCKET_NAME and VECTOR_INDEX_NAME must be set (see .env.example) "
            "before ingestion can run."
        )

    vectors = []
    for doc in DOCUMENTS:
        vector = await embed(doc["text"])
        vectors.append(
            {
                "key": doc["id"],
                "data": {"float32": vector},
                # The text itself rides along as metadata so query_context()
                # can return it directly without a second lookup.
                "metadata": {"text": doc["text"], **doc["metadata"]},
            }
        )
        logger.info("embedded %s (%d dims)", doc["id"], len(vector))

    s3vectors_client.put_vectors(
        vectorBucketName=VECTOR_BUCKET_NAME,
        indexName=VECTOR_INDEX_NAME,
        vectors=vectors,
    )
    logger.info("put_vectors: %d documents indexed into %s/%s", len(vectors), VECTOR_BUCKET_NAME, VECTOR_INDEX_NAME)


if __name__ == "__main__":
    asyncio.run(main())
