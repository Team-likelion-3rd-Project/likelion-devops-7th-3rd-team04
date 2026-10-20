# langchain_rag/n8n — 오케스트레이션 워크플로

`backend/apps/chat-bot-service/src/n8n/n8n.client.ts`가 호출하는 `N8N_WEBHOOK_URL` 계약을 구현합니다.
요청은 `{sessionId?, userId?, message, history}`, 응답은 `{reply, intent, action}`입니다.

`workflows/chat-orchestration.json`의 노드 구성:

```
Webhook (POST /webhook/chat)
  → Map to llm-service contract   (Code: USER/ASSISTANT → user/assistant, sessionId/userId 제거, authenticated = !!userId)
  → Call llm-service               (HTTP Request: POST llm-service:8000/chat, 타임아웃 120초)
  → Respond to Webhook             ({ reply, intent, action })
```

RAG 검색과 예약·결제·취소 의도 분류는 워크플로에서 하지 않습니다. 둘 다 llm-service가 합니다(`../llm-service/README.md`의 "RAG 검색", "예약·결제·취소 액션" 참고). `authenticated`는 답변 문구에만 쓰이고, 액션 검증과 비로그인 차단은 chat-bot-service가 합니다.

## 로컬 실행

```bash
docker compose -f ../docker-compose.yml up --build
```

`ollama`, `llm-service`, `n8n`, `n8n-init`이 뜹니다. `n8n-init`은 워크플로를 import하고 활성화한 뒤 종료합니다.

**웹훅이 404일 때:** `http://localhost:5678`에서 워크플로가 있고 "Active"가 켜져 있는지 먼저 확인하세요. 꺼져 있으면 n8n을 재시작합니다.

```bash
docker compose -f ../docker-compose.yml restart n8n
```

그래도 안 되면 `n8n-init`이 성공했는지 확인합니다.

```bash
docker compose -f ../docker-compose.yml logs n8n-init
```

import가 실패했다면 n8n을 재시작해도 소용없습니다(활성화할 워크플로가 없음). 원인을 고친 뒤 다시 실행하세요.

```bash
docker compose -f ../docker-compose.yml up n8n-init
```

## 테스트

**(a) 전체 경로 테스트** — `n8n.client.ts`와 같은 형태의 요청을 웹훅에 보냅니다.

```bash
curl -X POST http://localhost:5678/webhook/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-session","userId":1,"message":"체크인은 몇 시부터 가능한가요?","history":[{"role":"USER","content":"안녕하세요"},{"role":"ASSISTANT","content":"안녕하세요! 무엇을 도와드릴까요?"}]}'
```

`{"reply": "..."}`가 오면 n8n → llm-service → Ollama 전체 경로와 대문자 → 소문자 role 변환이 동작하는 것입니다. 답변이 RAG에 근거하는지는 llm-service에 AWS 자격 증명이 있고 `scripts/ingest.py`로 인덱스를 채웠는지에 달려 있습니다. 없어도 근거 없이 답변은 옵니다.

**(b) context 주입 테스트** — n8n을 거치지 않고 llm-service에 `context`를 직접 넣어, RAG 대신 그 값이 프롬프트에 들어가는지 확인합니다.

```bash
curl -X POST http://localhost:8001/chat -H 'Content-Type: application/json' \
  -d '{"message":"컨텍스트에 있는 문장을 그대로 반복해줘.","history":[],"context":"TEST-CONTEXT-12345"}'
```

답변에 `TEST-CONTEXT-12345`가 들어 있으면 정상입니다.

## backend와 연결

이 스택은 backend와 별개 Compose 프로젝트라 자동으로 연결되지 않습니다. backend의 `chat-bot-service`에서 호출하려면 `backend/.env`의 `N8N_WEBHOOK_URL`을 이 n8n으로 지정하세요(`backend/.env.example` 참고, 기본값 `http://host.docker.internal:5678/webhook/chat`).

`N8N_TIMEOUT_MS`(기본 30초)가 워크플로의 llm-service 호출 타임아웃(120초)보다 짧습니다. CPU 전용 로컬 Ollama는 응답이 30초를 넘을 수 있으니, 그럴 때는 `N8N_TIMEOUT_MS`를 늘리세요.
