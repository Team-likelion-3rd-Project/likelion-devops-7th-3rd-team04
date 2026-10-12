"""Real RAG retrieval: embeds text via the self-hosted Ollama embedding model
and queries the S3 Vectors index directly via boto3 (`infra/terraform/modules/ai_data`).

This is what `chain.py`'s `_retrieve_context` calls now that the index can
actually be queried — see that module's docstring, which already anticipated
this. `scripts/ingest.py` is the write-side counterpart that populates the
index from `app/corpus.py`.

boto3's `s3vectors` client (verified against boto3==1.43.73, 2026-08 — check
here first if AWS changes this API's shape later):
  - put_vectors(vectorBucketName, indexName, vectors=[
        {"key": str, "data": {"float32": [float, ...]}, "metadata": {...}},
    ])
  - query_vectors(vectorBucketName, indexName, topK, queryVector={"float32": [...]},
        returnMetadata=True, returnDistance=True)
    -> {"vectors": [{"key", "distance", "metadata"}], "distanceMetric", "nextToken"}

Retrieval is deliberately best-effort: if the vector store isn't configured
(no VECTOR_BUCKET_NAME) or the query fails for any reason (network, IAM,
throttling), this returns None rather than raising — chain.py's contract is
that llm-service keeps answering (without grounding) rather than 500ing when
RAG is unavailable.
"""

import asyncio
import logging
import os

import boto3
from langchain_ollama import OllamaEmbeddings

logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
VECTOR_BUCKET_NAME = os.getenv("VECTOR_BUCKET_NAME")
VECTOR_INDEX_NAME = os.getenv("VECTOR_INDEX_NAME")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "3"))

_embeddings = OllamaEmbeddings(base_url=OLLAMA_BASE_URL, model=OLLAMA_EMBED_MODEL)

# None when VECTOR_BUCKET_NAME isn't set (local dev without AWS) — every
# caller below treats that as "retrieval unavailable", not an error.
s3vectors_client = boto3.client("s3vectors", region_name=AWS_REGION) if VECTOR_BUCKET_NAME else None


def is_configured() -> bool:
    return s3vectors_client is not None and bool(VECTOR_INDEX_NAME)


async def embed(text: str) -> list[float]:
    """Embed `text` with the self-hosted Ollama embedding model."""
    return await _embeddings.aembed_query(text)


async def query_context(message: str, top_k: int = RAG_TOP_K) -> str | None:
    """Embed `message`, query the S3 Vectors index, and join the top-k
    matches' `metadata.text` into one context string. Never raises."""
    if not is_configured():
        return None

    try:
        vector = await embed(message)
        response = await asyncio.to_thread(
            s3vectors_client.query_vectors,
            vectorBucketName=VECTOR_BUCKET_NAME,
            indexName=VECTOR_INDEX_NAME,
            topK=top_k,
            queryVector={"float32": vector},
            returnMetadata=True,
            returnDistance=True,
        )
    except Exception:
        logger.exception("S3 Vectors retrieval failed; continuing without RAG context")
        return None

    matches = response.get("vectors", [])
    texts = [m["metadata"]["text"] for m in matches if m.get("metadata", {}).get("text")]
    return "\n---\n".join(texts) if texts else None
