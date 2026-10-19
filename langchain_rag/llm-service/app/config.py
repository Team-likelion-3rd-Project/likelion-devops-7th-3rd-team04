"""llm-service 환경변수 설정. 변수 설명은 .env.example을 참고하세요."""

import os

# LLM / 임베딩 (Ollama)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# RAG 검색 (S3 Vectors) — VECTOR_BUCKET_NAME이 비어 있으면 RAG 없이 동작합니다.
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
VECTOR_BUCKET_NAME = os.getenv("VECTOR_BUCKET_NAME")
VECTOR_INDEX_NAME = os.getenv("VECTOR_INDEX_NAME")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "3"))
