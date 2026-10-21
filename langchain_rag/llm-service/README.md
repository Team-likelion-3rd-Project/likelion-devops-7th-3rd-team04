# langchain_rag/llm-service — LangChain 대화 API

챗봇 한 턴을 처리하는 FastAPI 서비스입니다. 프롬프트 조립(RAG 검색 결과 포함)과 LLM 호출을 담당하며,
호출 흐름은 `chat-bot-service → n8n(../n8n) → llm-service → LLM`입니다.

| 환경 | LLM·임베딩 (`LLM_PROVIDER`) | RAG 벡터 스토어 (`VECTOR_STORE`) | 배포 |
|---|---|---|---|
| 로컬 docker compose | `ollama` (../ollama) | `s3vectors` (AWS 자격 증명이 없으면 RAG 없이 동작) | `../docker-compose.yml` |
| 온프레미스 dev | `vertex` (Gemini · `text-multilingual-embedding-002`) | `object` (DB 노드 MinIO 의 `rag-index` 버킷) | backend Helm 차트 (`infra/ansible/README.md` 15절) |
| prod (EKS) | `vertex` | `s3vectors` | prod gitops (예정) |

## 구성

| 파일 | 역할 |
|---|---|
| `app/main.py` | HTTP 엔드포인트 (`POST /chat`, `GET /health`) |
| `app/chain.py` | 의도 분류 → 프롬프트 + 대화 이력 + LLM 호출 |
| `app/llm.py` | LLM·임베딩 공급자 선택 (Ollama / Vertex AI). 클라이언트는 첫 호출 때 생성 |
| `app/intent.py` | 예약·결제·취소 의도 분류와 예약 슬롯 추출·검증 |
| `app/retrieval.py` | RAG 검색 (질문 임베딩 → 벡터 스토어 조회) |
| `app/vector_store.py` | 벡터 스토어 구현 (S3 Vectors / S3 호환 저장소의 JSON / 없음) |
| `app/corpus.py` | RAG 인덱스에 넣을 문서 (호텔·객실·부대시설·정책) |
| `app/config.py` | 환경변수 설정 (`.env.example` 참고) |
| `scripts/ingest.py` | `corpus.py`를 임베딩해 벡터 스토어에 적재 |
| `tests/` | 의도 검증 · 벡터 스토어 · 공급자 선택 테스트 (`pip install -r requirements-dev.txt && python -m pytest tests`). CI `test:llm-service` |

## API

`POST /chat`

```json
// request
{ "message": "서울점 다음 주 금요일부터 2박 예약할래", "history": [], "authenticated": true }

// response
{
  "reply": "...",
  "intent": "BOOK",
  "action": { "type": "BOOK", "hotel": "seoul", "roomName": null, "checkIn": "2026-10-23", "checkOut": "2026-10-25", "adults": 2, "children": 0 }
}
```

- `history`: `{ "role": "user" | "assistant", "content": string }` 배열, 오래된 순.
- `context`(선택): 답변 근거를 직접 지정합니다. 넣으면 RAG 검색을 건너뜁니다(테스트용).
- `authenticated`(선택, 기본 false): 로그인 사용자 여부. n8n이 채우며 **답변 문구에만** 씁니다.
- `intent`: `BOOK | PAY | CANCEL | null`. 슬롯이 모자라도 의도만 있으면 채웁니다.
- `action`: BOOK은 필수 슬롯(hotel·checkIn·checkOut)이 다 모였을 때만, PAY/CANCEL은 `{type}`만 담습니다. 비로그인이면 항상 `null`입니다. 아래 "예약·결제·취소 액션" 참고.

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

Vertex AI로 돌려 보려면 서비스 계정 키를 넘깁니다(컨테이너에는 호스트의 ADC가 없음). 컨테이너 밖에서 `uvicorn`으로 직접 띄울 때는 `gcloud auth application-default login`(ADC)으로도 됩니다.

```bash
export LLM_PROVIDER=vertex GCP_SA_KEY_JSON="$(cat ../../infra/ansible/.secrets/llm-service-dev-sa.json)"
docker compose -f ../docker-compose.yml up --build llm-service n8n n8n-init
```

이미 떠 있는 Ollama에 붙여 단독으로 실행하려면:

```bash
cp .env.example .env   # OLLAMA_BASE_URL/OLLAMA_MODEL 확인
pip install -r requirements.txt
uvicorn app.main:app --env-file .env --reload
```

## RAG 검색

`POST /chat`에 `context`가 없으면 `app/retrieval.py`가 질문을 임베딩해 벡터 스토어에서 가까운 문서 `RAG_TOP_K`개를 찾아 프롬프트에 붙입니다. 스토어가 설정되지 않았거나 조회가 실패하면(자격 증명 없음, 네트워크, 권한 등) 에러를 내지 않고 근거 없이 답변합니다.

| `VECTOR_STORE` | 동작 | 필요한 값 |
|---|---|---|
| `s3vectors` (기본) | AWS S3 Vectors `query_vectors` | `VECTOR_BUCKET_NAME`, `VECTOR_INDEX_NAME`, `AWS_REGION`, AWS 자격 증명(prod 는 Pod Identity) |
| `object` | S3 호환 저장소(MinIO)에 있는 임베딩 JSON 파일 하나를 메모리에 올려 코사인 유사도로 검색. `VECTOR_OBJECT_REFRESH_SECONDS`(기본 300)마다 ETag 가 바뀌었으면 다시 읽음 | `VECTOR_OBJECT_ENDPOINT`, `VECTOR_OBJECT_BUCKET`, `VECTOR_OBJECT_KEY`(기본 `rag/index.json`), `VECTOR_OBJECT_ACCESS_KEY` / `SECRET_KEY` |
| `none` | RAG 없음 | — |

- 인덱스에는 만든 임베딩 모델(`ollama:...` / `vertex:...`)이 기록됩니다. `object` 스토어는 현재 설정과 모델이 다르면 **인덱스를 쓰지 않고** 로그를 남깁니다. 공급자나 임베딩 모델을 바꾸면 ingest 를 다시 실행하세요.
- Vertex 임베딩은 질문(`RETRIEVAL_QUERY`)과 문서(`RETRIEVAL_DOCUMENT`)를 구분해 임베딩합니다(`embed_query` / `embed_documents`).
- Gemini 는 서울 리전에서 용량 부족(429)이 잦아 채팅은 `VERTEX_CHAT_LOCATION=global`, 임베딩은 `GCP_LOCATION=asia-northeast3` 을 씁니다.

## 예약·결제·취소 액션

대화 중 사용자가 예약·결제·취소 의사를 보이면 답변에 **액션 카드 데이터**를 붙입니다. 이 서비스는 아무것도 실행하지 않습니다 — 실제 동작은 사용자가 프론트 카드에서 눌러 **자기 JWT로 기존 API**를 호출해서 합니다.

1. `app/intent.py`가 최근 이력(`INTENT_HISTORY_MESSAGES`개)과 현재 메시지로 의도와 슬롯을 뽑습니다(JSON 모드, temperature 0).
   - 의도는 마지막 사용자 메시지 기준, 슬롯은 대화 전체에서 가장 최근 값(정정 반영). 서버 상태는 없습니다.
   - 상대 날짜는 오늘(Asia/Seoul) 기준으로 해석합니다.
2. `validate()`가 화이트리스트로 다시 거릅니다: 지점 slug, 실제 날짜·오늘 이후·365일 이내·체크아웃>체크인, 성인 1~10(기본 2)·아동 0~10, 객실명은 해당 지점 객실과 정확히 일치할 때만.
3. 상황별 지시를 답변 프롬프트에 붙입니다: 슬롯 부족 → 되묻기, 액션 있음 → 버튼 안내, 비로그인 → 로그인 안내.

보안 원칙:

- LLM 출력은 사용자 입력과 같은 수준으로 믿지 않습니다. 예약 ID·금액·URL은 애초에 뽑지 않습니다.
- LLM에는 사용자 예약 정보를 주지 않습니다. 결제·취소 대상은 프론트가 본인 예약을 직접 조회합니다.
- chat-bot-service(`backend/apps/chat-bot-service/src/chat-action.ts`)가 같은 규칙으로 한 번 더 검증하고, 비로그인이면 액션을 버린 뒤 `LOGIN_REQUIRED`로 바꿉니다.

### 인덱스 적재

`scripts/ingest.py`가 `app/corpus.py`의 문서를 임베딩해 선택된 벡터 스토어에 씁니다. `s3vectors`는 key 단위로 덮어쓰고(`s3vectors:PutVectors` 권한 필요), `object`는 인덱스 파일 전체를 새로 씁니다(버킷 쓰기 권한 필요).

```bash
# 로컬
python -m scripts.ingest

# compose로 띄운 컨테이너 안에서
docker compose -f ../docker-compose.yml exec llm-service python -m scripts.ingest

# 온프레미스 dev 클러스터 (배포 후 1회, corpus 가 바뀔 때마다)
kubectl -n backend exec deploy/llm-service -- python -m scripts.ingest
```

`corpus.py`의 호텔·객실·부대시설 문서는 `backend/scripts/seed.ts`를 옮긴 것입니다. seed를 바꾸면 `corpus.py`도 함께 고치고 ingest를 다시 실행하세요.
