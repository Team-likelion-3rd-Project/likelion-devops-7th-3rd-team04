# langchain_rag/ollama — 로컬 LLM 노드

채팅 모델과 임베딩 모델을 **빌드할 때 미리 받아 둔** Ollama 이미지입니다. 컨테이너를 띄울 때 `ollama pull`을 하지 않으므로, 기동할 때마다 수 GB짜리 모델을 내려받지 않습니다.

> 현재 llm-service의 LLM·임베딩 백엔드입니다. dev/prod 모두 GCP Vertex AI로 옮길 예정이며, 이는 별도 작업입니다.

## 모델

| 용도 | 기본값 | 빌드 인자 |
|---|---|---|
| 채팅 | `qwen2.5:7b-instruct` — 한국어 지원이 무난하고 Apache-2.0 라이선스 | `OLLAMA_MODEL` |
| 임베딩 (RAG) | `nomic-embed-text` — 768차원, S3 Vectors 인덱스 차원과 맞아야 함 | `OLLAMA_EMBED_MODEL` |

모델을 바꾸면 llm-service의 같은 이름 환경변수도 맞춰야 합니다.

## 빌드

```bash
docker build -t local/ollama-hotel .

# CPU 전용 로컬에서 빠르게 테스트하려면 작은 모델로
docker build --build-arg OLLAMA_MODEL=qwen2.5:0.5b-instruct -t local/ollama-hotel .
```

## 단독 실행

```bash
docker run --rm -p 11434:11434 local/ollama-hotel
curl localhost:11434/api/tags   # pull 없이 모델이 바로 보여야 함
```

NVIDIA 컨테이너 런타임이 없으면 CPU로 동작합니다. HTTP 계약 확인에는 충분하지만 느립니다.

보통은 단독으로 띄우지 않고 `../docker-compose.yml`로 llm-service와 함께 띄웁니다.
