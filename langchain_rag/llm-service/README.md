# langchain_rag/llm-service — LangChain 대화 API

챗봇 한 턴을 처리하는 FastAPI 서비스입니다. 프롬프트 조립(RAG 검색 결과 포함)과 LLM 호출을 담당하며,
호출 흐름은 `chat-bot-service → n8n(../n8n) → llm-service → Ollama(../ollama)`입니다.

> 현재 LLM·임베딩은 로컬 Ollama를 씁니다. dev/prod 모두 GCP Vertex AI로 옮길 예정이며, 이는 별도 작업입니다.

## 구성

| 파일 | 역할 |
|---|---|
| `app/main.py` | HTTP 엔드포인트 (`POST /chat`, `GET /health`) |
| `app/chain.py` | 프롬프트 + 대화 이력 + LLM 호출 |
| `app/retrieval.py` | RAG 검색 (Ollama 임베딩 → S3 Vectors 조회) |
| `app/corpus.py` | RAG 인덱스에 넣을 문서 (호텔·객실·부대시설·정책) |
| `app/config.py` | 환경변수 설정 (`.env.example` 참고) |
| `scripts/ingest.py` | `corpus.py`를 임베딩해 S3 Vectors에 적재 |

## API

`POST /chat`

```json
// request
{ "message": "안녕하세요, 예약 가능한 방 있나요?", "history": [] }

// response
{ "reply": "..." }
```

- `history`: `{ "role": "user" | "assistant", "content": string }` 배열, 오래된 순.
- `context`(선택): 답변 근거를 직접 지정합니다. 넣으면 RAG 검색을 건너뜁니다(테스트용).

`GET /health` — liveness 확인.

## 로컬 실행

```bash
cp .env.example .env
docker compose -f ../docker-compose.yml up --build
curl localhost:8001/health
curl localhost:8001/chat -X POST -H 'Content-Type: application/json' \
    -d '{"message": "안녕하세요, 예약 가능한 방 있나요?", "history": []}'
```

- 호스트 포트는 `8001`입니다. `backend/docker-compose.yml`의 `dynamodb-local`이 `8000`을 쓰고 두 Compose 프로젝트를 동시에 띄울 수 있어서입니다. 컨테이너끼리는 `llm-service:8000`으로 호출합니다.
- `.env`는 compose가 읽습니다. 다만 `docker-compose.yml`의 `environment:`에 적힌 값이 우선합니다.
- 첫 빌드는 Ollama 이미지에 모델을 받느라 오래 걸리고, 이후엔 캐시됩니다.

이미 떠 있는 Ollama에 붙여 단독으로 실행하려면:

```bash
cp .env.example .env   # OLLAMA_BASE_URL/OLLAMA_MODEL 확인
pip install -r requirements.txt
uvicorn app.main:app --env-file .env --reload
```

## RAG 검색

`POST /chat`에 `context`가 없으면 `app/retrieval.py`가 질문을 임베딩(`OLLAMA_EMBED_MODEL`)해 S3 Vectors 인덱스에서 가까운 문서 `RAG_TOP_K`개를 찾아 프롬프트에 붙입니다.

`VECTOR_BUCKET_NAME`이 없거나 조회가 실패하면(자격 증명 없음, 네트워크, IAM 등) 에러를 내지 않고 근거 없이 답변합니다.

### 인덱스 적재

`scripts/ingest.py`가 `app/corpus.py`의 문서를 임베딩해 `put_vectors`로 씁니다. 문서마다 key가 고정이라 다시 실행해도 덮어씁니다. AWS 자격 증명과 `s3vectors:PutVectors` 권한이 필요합니다.

```bash
# 로컬
python -m scripts.ingest

# compose로 띄운 컨테이너 안에서
docker compose -f ../docker-compose.yml exec llm-service python -m scripts.ingest
```

`corpus.py`의 호텔·객실·부대시설 문서는 `backend/scripts/seed.ts`를 옮긴 것입니다. seed를 바꾸면 `corpus.py`도 함께 고치고 ingest를 다시 실행하세요.
