"""llm-service 환경변수 설정. 변수 설명은 .env.example을 참고하세요."""

import os

# LLM / 임베딩 공급자: ollama(로컬 compose 기본) | vertex(dev·prod)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")

# Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b-instruct")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

# GCP Vertex AI. GCP_SA_KEY_JSON(서비스 계정 키 JSON 문자열)이 없으면 ADC를 씁니다.
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
# 임베딩 리전. Gemini는 서울 리전에서 용량 부족(429)이 잦아 채팅은 global 엔드포인트를 따로 씁니다.
GCP_LOCATION = os.getenv("GCP_LOCATION", "asia-northeast3")
VERTEX_CHAT_LOCATION = os.getenv("VERTEX_CHAT_LOCATION", "global")
GCP_SA_KEY_JSON = os.getenv("GCP_SA_KEY_JSON")
VERTEX_CHAT_MODEL = os.getenv("VERTEX_CHAT_MODEL", "gemini-2.5-flash")
VERTEX_EMBED_MODEL = os.getenv("VERTEX_EMBED_MODEL", "text-multilingual-embedding-002")

# RAG 벡터 스토어: s3vectors(prod, AWS S3 Vectors) | object(dev, MinIO 등 S3 호환 저장소의 JSON) | none
VECTOR_STORE = os.getenv("VECTOR_STORE", "s3vectors")
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "3"))

# VECTOR_STORE=s3vectors — VECTOR_BUCKET_NAME이 비어 있으면 RAG 없이 동작합니다.
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
VECTOR_BUCKET_NAME = os.getenv("VECTOR_BUCKET_NAME")
VECTOR_INDEX_NAME = os.getenv("VECTOR_INDEX_NAME")

# VECTOR_STORE=object — 임베딩 JSON 파일 하나를 S3 호환 저장소에서 읽어 메모리에서 검색합니다.
VECTOR_OBJECT_ENDPOINT = os.getenv("VECTOR_OBJECT_ENDPOINT")
VECTOR_OBJECT_BUCKET = os.getenv("VECTOR_OBJECT_BUCKET")
VECTOR_OBJECT_KEY = os.getenv("VECTOR_OBJECT_KEY", "rag/index.json")
VECTOR_OBJECT_REGION = os.getenv("VECTOR_OBJECT_REGION", "ap-northeast-2")
VECTOR_OBJECT_ACCESS_KEY = os.getenv("VECTOR_OBJECT_ACCESS_KEY")
VECTOR_OBJECT_SECRET_KEY = os.getenv("VECTOR_OBJECT_SECRET_KEY")
VECTOR_OBJECT_REFRESH_SECONDS = int(os.getenv("VECTOR_OBJECT_REFRESH_SECONDS", "300"))

# 의도 분류(app/intent.py)에 넣을 최근 대화 이력 메시지 수.
INTENT_HISTORY_MESSAGES = int(os.getenv("INTENT_HISTORY_MESSAGES", "10"))
