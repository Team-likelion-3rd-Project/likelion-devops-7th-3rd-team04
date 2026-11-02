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
| `app/chain.py` | 의도 분류와 RAG 검색(동시 실행) → 근거 기반 프롬프트 + 대화 이력 + LLM 호출 |
| `app/llm.py` | LLM·임베딩 공급자 선택 (Ollama / Vertex AI). 클라이언트는 첫 호출 때 생성 |
| `app/intent.py` | 예약·결제·취소 의도 분류와 예약 슬롯 추출·검증 |
| `app/retrieval.py` | RAG 검색 (질문 임베딩 → 지점 필터 · 벡터 스토어 조회 → 유사도 임계값) |
| `app/vector_store.py` | 벡터 스토어 구현 (S3 Vectors / S3 호환 저장소의 JSON / 없음) |
| `app/corpus.py` | RAG 인덱스에 넣을 문서 (호텔·객실·요금·부대시설·공지·브랜드·정책) |
| `app/rag_catalog.json` | 호텔·객실·부대시설·공지 원본. `backend/scripts/seed-catalog.ts`에서 생성하는 파일이라 직접 고치지 않음 |
| `app/config.py` | 환경변수 설정 (`.env.example` 참고) |
| `scripts/ingest.py` | `corpus.py`를 임베딩해 벡터 스토어에 적재하고, corpus에 없는 문서는 인덱스에서 지움 |
| `scripts/eval_retrieval.py` | 검색 품질(hit@k) 점검과 `RAG_MIN_SCORE` 보정 |
| `tests/` | 의도 검증 · 코퍼스 · 검색 · 체인 · 벡터 스토어 · 공급자 선택 테스트 (`pip install -r requirements-dev.txt && python -m pytest tests`). CI `test:llm-service` |

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

`GET /health` — K8s probe용 상태 확인입니다. Vertex나 벡터 스토어 같은 외부는 호출하지 않습니다.

```json
{"status": "ok",
 "llm": {"provider": "vertex", "lastSuccessAt": "2026-11-02T...", "lastFailureAt": null, "lastError": null},
 "vectorStore": {"type": "object", "configured": true, "documents": 17}}
```

- `LLM_PROVIDER`·`VECTOR_STORE` 값이 잘못됐으면 `503 {"status": "error"}`를 반환합니다. 배포 직후 startup probe에서 걸립니다.
- 그 밖에는 200입니다. 마지막 `/chat` 실패나 RAG 미설정은 파드를 재시작해도 낫지 않으므로 상태로만 보여 줍니다.
- `documents`는 `object` 스토어만 표시합니다. 메모리에 올린 문서 수이며, 아직 읽지 않았으면 `null`, 모델·차원이 맞지 않아 거부했으면 `0`입니다.

### 타임아웃·재시도

| 변수 | 기본 | 설명 |
|---|---|---|
| `CHAT_REQUEST_TIMEOUT_SECONDS` | 40 | `/chat` 한 턴 전체 마감. 넘으면 504 |
| `LLM_TIMEOUT_SECONDS` | 15 | LLM 호출 1회 타임아웃. RAG 검색(임베딩+조회)도 이 시간 안에 못 끝나면 근거 없이 진행 |
| `LLM_MAX_RETRIES` | 2 | Vertex 429·5xx·타임아웃 시 지수 백오프(4→10초) 재시도 횟수. Ollama는 재시도하지 않음 |

바깥 n8n·chat-bot-service(50초)보다 먼저 끊기도록 맞춘 값입니다. 전체 구간은 `../n8n/README.md`의 타임아웃 절을 참고하세요.

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

`POST /chat`에 `context`가 없으면 `app/retrieval.py`가 질문을 임베딩해 벡터 스토어에서 가까운 문서 `RAG_TOP_K`개를 찾습니다. 의도 분류(`app/intent.py`)와는 서로 결과가 필요 없어 `asyncio.gather`로 동시에 실행합니다. 스토어가 설정되지 않았거나 조회가 실패하면(자격 증명 없음, 네트워크, 권한 등) 에러를 내지 않고 근거 없이 답변합니다.

- **지점 필터**: 질문에 지점 이름이나 별칭(`corpus.HOTEL_ALIASES` — 예: 해운대 → 부산점)이 나오면 그 지점 문서와 공통 문서(metadata `hotel: "all"`)에서만 찾습니다. LLM을 부르지 않는 키워드 매칭입니다.
- **유사도 임계값**: 코사인 유사도가 `RAG_MIN_SCORE`(기본 0.62) 미만인 문서는 버립니다. 값은 `scripts/eval_retrieval.py`로 정했습니다(관련 질문 20개 hit@3 20/20, 기대 문서 최저 0.646, 무관 질문 0.53~0.68). 임베딩 모델이나 corpus를 크게 바꾸면 다시 돌리세요.
- **근거 기반 답변**: 검색 결과는 시스템 프롬프트의 `<context>` 블록에 들어갑니다. 지점·객실·요금·정책·부대시설·공지에 대한 사실은 그 안의 내용으로만 답하고, 없으면 모른다고 하며 지점 연락처를 안내하도록 지시합니다. 검색 결과가 없으면 그 사실을 프롬프트에 명시합니다.

```bash
LLM_PROVIDER=vertex GCP_SA_KEY_JSON="$(cat ../../infra/ansible/.secrets/llm-service-dev-sa.json)" python -m scripts.eval_retrieval
```

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

`scripts/ingest.py`가 `app/corpus.py`의 문서를 임베딩해 선택된 벡터 스토어에 씁니다. 적재가 끝나면 인덱스는 corpus와 정확히 같아집니다.

- `s3vectors`: key 단위로 덮어쓴 뒤, `list_vectors`로 corpus에 없는 key를 찾아 `delete_vectors`로 지웁니다. `s3vectors:PutVectors` · `ListVectors` · `DeleteVectors` 권한이 필요합니다(prod: Terraform `51-pod-roles`의 llm-ingest Role).
- `object`: 인덱스 파일 전체를 새로 씁니다(버킷 쓰기 권한 필요).
- 클러스터에서는 backend 차트의 `llm-ingest` Job이 llm-service 이미지가 바뀔 때마다 실행합니다(dev·prod 모두 gitops values `llmIngest.enabled`).

```bash
# 로컬
python -m scripts.ingest

# compose로 띄운 컨테이너 안에서
docker compose -f ../docker-compose.yml exec llm-service python -m scripts.ingest

# 클러스터에서 수동으로 다시 적재할 때
kubectl -n backend exec deploy/llm-service -- python -m scripts.ingest
```

### 호텔 데이터 동기화 (rag catalog)

호텔·객실·부대시설·공지 데이터의 원본은 DB 시딩과 같은 `backend/scripts/seed-catalog.ts` 하나입니다. llm-service 이미지는 backend 파일을 읽을 수 없어서, 그 데이터를 `app/rag_catalog.json`으로 내보내 커밋해 둡니다.

```bash
cd backend && npm run rag:export-catalog   # seed-catalog.ts 를 고친 뒤 실행해 JSON 을 함께 커밋
```

두 파일이 어긋나면 backend CI(`scripts/export-rag-catalog.spec.ts`)가 실패합니다. 브랜드 소개 문서는 `frontend/src/data/brandValues.ts`, 정책 문서는 `corpus.py`에 직접 적혀 있습니다.

문서 metadata의 `hotel`이 지점 한글 이름에서 slug / `"all"`로 바뀌었습니다. 이전에 적재한 인덱스는 지점 필터에 걸리지 않으므로 이번 변경을 배포할 때 다시 적재해야 합니다(Job이 자동으로 처리).
