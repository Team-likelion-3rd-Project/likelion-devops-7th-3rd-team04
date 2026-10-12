# langchain_rag/n8n/ — orchestration workflow

Implements the `N8N_WEBHOOK_URL` contract `backend/apps/chat-bot-service/src/n8n/n8n.client.ts` already calls (`{sessionId?, userId?, message, history}` in, `{reply}` out). Nothing pointed at that URL until now.

`workflows/chat-orchestration.json` is the workflow, four nodes:

```
Webhook (POST /webhook/chat)
  → Map to llm-service contract   (Code: USER/ASSISTANT → user/assistant, drops sessionId/userId)
  → Call llm-service               (HTTP Request: POST llm-service:8000/chat)
  → Respond to Webhook             ({ reply })
```

RAG used to be mocked here with a "Mock RAG (placeholder)" node (a fixed
string as `context`). That node is gone now — `langchain_rag/llm-service/app/chain.py`
does its own real S3 Vectors retrieval whenever it's called without a
`context` field, which is exactly what this workflow sends. See
`../llm-service/README.md`'s "RAG retrieval" section for how that works and
how to populate the index.

## Running locally

```bash
docker compose -f ../docker-compose.yml up --build   # or: cd .. && docker compose up --build
```

Brings up `ollama`, `llm-service`, `n8n`, and `n8n-init` (imports the workflow once, active, into `n8n`'s DB).

**If the webhook 404s** (`n8n` had already finished booting before `n8n-init` wrote the active workflow — see the comment in `../docker-compose.yml`), run:

```bash
docker compose -f ../docker-compose.yml restart n8n
```

You can also open `http://localhost:5678` and check the workflow is listed and its "Active" toggle is on.

If that doesn't fix it, check whether `n8n-init` actually succeeded in the
first place — `docker compose -f ../docker-compose.yml logs n8n-init` should
show a successful import, not an error/non-zero exit. If it failed outright,
restarting `n8n` won't help (there was never a workflow to activate); fix
whatever broke the import and re-run `docker compose -f ../docker-compose.yml up n8n-init`.

## Testing

**(a) Full-path orchestration test** — mimics `n8n.client.ts`'s exact request shape against the webhook:

```bash
curl -X POST http://localhost:5678/webhook/chat -H 'Content-Type: application/json' \
  -d '{"sessionId":"test-session","userId":1,"message":"체크인은 몇 시부터 가능한가요?","history":[{"role":"USER","content":"안녕하세요"},{"role":"ASSISTANT","content":"안녕하세요! 무엇을 도와드릴까요?"}]}'
```

Expect `{"reply": "..."}` — proves the whole local chain (n8n → llm-service → Ollama) end-to-end, including the uppercase→lowercase role mapping. Whether the reply is actually *grounded* in RAG content depends on whether `llm-service`'s `VECTOR_BUCKET_NAME`/AWS credentials are set up and `scripts/ingest.py` has been run against the real index — see `../llm-service/README.md`; without that, this still works, just without retrieval.

**(b) Context-injection test** — verifies the `context` override mechanism `llm-service` still supports (bypasses RAG entirely), independent of n8n, by calling `llm-service` directly and asking the model to echo back what it was given:

```bash
curl -X POST http://localhost:8001/chat -H 'Content-Type: application/json' \
  -d '{"message":"컨텍스트에 있는 문장을 그대로 반복해줘.","history":[],"context":"TEST-CONTEXT-12345"}'
```

(Host port `8001` — see the port-mapping comment in `../docker-compose.yml`; the internal call n8n makes above still uses `llm-service:8000`.)

Expect the reply to contain `TEST-CONTEXT-12345`, confirming an explicitly-supplied `context` still overrides RAG and reaches the prompt sent to Ollama.

## Not in scope here

Deploying n8n anywhere (this is a local-only Docker Compose instance — the in-cluster deployment at `gitops/langchain/base/n8n/` is a separate manifest, not driven by this compose file), and pointing `backend/.env`'s `N8N_WEBHOOK_URL` at this instance to test the full `chat-bot-service` → n8n chain (you can do that manually — `N8N_WEBHOOK_URL=http://localhost:5678/webhook/chat` — but it isn't wired up automatically, to keep this stack independent of the `backend/` one, same as `llm-service`/`ollama`).
