# langchain_rag/llm-service/ — LangChain HTTP orchestration API

The "LLM Service (FastAPI)" from `CLAUDE.md`'s Chatbot / AI subsystem
section: a FastAPI app that orchestrates one chat turn — prompt assembly
(including RAG-retrieved context, see below) and the call to the
self-hosted Ollama node (`../ollama/`) — behind a small HTTP contract.

Nothing in `backend/` calls this yet. Per the intended architecture,
`chat-bot-service` calls **n8n**, and n8n is meant to call this service; n8n
itself doesn't exist yet, so today this is exercised directly (curl, or
later, an n8n HTTP Request node) rather than through the gRPC mesh.

## API

`POST /chat`

```json
// request
{ "message": "안녕하세요, 예약 가능한 방 있나요?", "history": [] }

// response
{ "reply": "..." }
```

`history` is a list of `{ "role": "user" | "assistant", "content": string }`,
oldest first.

`GET /health` — liveness check.

## Running locally

```bash
docker compose -f ../docker-compose.yml up --build   # or: cd .. && docker compose up --build
curl localhost:8001/health
curl localhost:8001/chat -X POST -H 'Content-Type: application/json' \
    -d '{"message": "안녕하세요, 예약 가능한 방 있나요?", "history": []}'
```

(Host port `8001`, not `8000` — `backend/docker-compose.yml`'s `dynamodb-local` already claims host `8000`, and the two Compose projects can run side by side. Internal/container-to-container calls still use `llm-service:8000`.)

This builds both `../ollama` (the model-baked-in Ollama image) and this
service, and wires them together. First build takes a while (pulling the
model into the Ollama image); subsequent builds are cached.

To run this service against an Ollama instance you're already running some
other way, skip Compose and just point it at that instance:

```bash
cp .env.example .env   # then edit OLLAMA_BASE_URL/OLLAMA_MODEL if needed
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## RAG retrieval

`app/retrieval.py` embeds the incoming message with a self-hosted Ollama
embedding model (`OLLAMA_EMBED_MODEL`, default `nomic-embed-text` — pulled
into the `../ollama/` image alongside the chat model) and queries the S3
Vectors index (`infra/terraform/modules/ai_data`) via `boto3`'s `s3vectors`
client. `app/chain.py`'s `_retrieve_context` calls this automatically
whenever `POST /chat` is called without a `context` field — which is what
`../n8n/`'s workflow does now, having dropped its old "Mock RAG
(placeholder)" node in favor of this.

If `VECTOR_BUCKET_NAME` isn't set, or the query fails for any reason (no AWS
credentials, network, IAM), retrieval just returns `None` — this service
keeps answering without grounding rather than erroring out. A caller can
still pass `context` explicitly (as before) to bypass retrieval entirely,
e.g. for the context-injection test in `../n8n/README.md`.

**Populating the index** — `scripts/ingest.py` embeds `app/corpus.py`'s
documents (the seeded hotels/rooms from `backend/scripts/seed.ts`, plus a
few hand-written policy documents) and writes them via `put_vectors`.
Idempotent (stable `key` per document), needs AWS credentials with
`s3vectors:PutVectors` (a separate Terraform change from the read-only
permission the chatbot role has today):

```bash
source /mnt/d/Desktop/AWS/aws-mfa.sh <profile> <otp>   # or any AWS_* creds
python -m scripts.ingest
```

In-cluster, run it against the live index using the pod's own EKS Pod
Identity instead: `kubectl exec -n langchain deploy/llm-service -- python -m scripts.ingest`.

## Not in scope here

Deploying either image to EKS — ECR push, Helm values, GPU
scheduling/autoscaling beyond what `gitops/langchain/` already does — is
separate, later work; see `CLAUDE.md`. Neptune-based (graph) retrieval is
also still unimplemented — only the S3 Vectors path above exists.
