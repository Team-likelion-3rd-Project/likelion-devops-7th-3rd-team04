# langchain_rag/ollama/ — self-hosted Ollama node

A custom Ollama image with the chat model **baked in at build time**, so
starting the container never needs a runtime `ollama pull`. This matters most
once this image runs on the EKS GPU node group (`infra/terraform/modules/eks`
— `g4dn.xlarge`, scaled to 0 by default): a cold node scale-up shouldn't also
have to download several GB of model weights before it can serve a request.

EKS deployment (ECR push, ArgoCD `Application`, GPU scheduling) now lives at
`gitops/langchain/base/ollama/` — this directory only produces the image and
lets it be run/tested locally. See `../llm-service/README.md` for the local
test harness.

## Model choice

Default chat model: **`qwen2.5:7b-instruct`**.

- Fits comfortably on a single T4 (16GB VRAM) at Q4 quantization, with
  headroom for context.
- Reasonable Korean support, which matters for this Korean-language
  hotel-booking chatbot.
- Apache-2.0 licensed.

This is a starting point, not a fixed decision — swap it via the
`OLLAMA_MODEL` build arg (see below) if the team picks a different model
(e.g. an EXAONE or Llama variant) later.

Default embedding model (for RAG retrieval, see `../llm-service/app/retrieval.py`):
**`nomic-embed-text`** — self-hosted (no Bedrock/OpenAI dependency), outputs
768-dim vectors. `infra/terraform/modules/ai_data`'s `vector_dimension` must
match this (separate Terraform branch — see the RAG section of
`../llm-service/README.md`). Override via `OLLAMA_EMBED_MODEL` build arg if
that ever changes.

## Building

```bash
docker build -t local/ollama-hotel .
```

To use a different (e.g. smaller, for fast local CPU-only testing) model:

```bash
docker build --build-arg OLLAMA_MODEL=qwen2.5:0.5b-instruct -t local/ollama-hotel .
```

## Running standalone

```bash
docker run --rm -p 11434:11434 local/ollama-hotel
curl localhost:11434/api/tags   # model should already be listed, no pull needed
```

GPU passthrough is optional — with no NVIDIA container runtime available
(e.g. this repo's WSL2 dev environment typically has none configured),
Ollama falls back to CPU. That's fine for exercising the HTTP contract; it's
just slow. For anything performance-sensitive, test against the real GPU
node instead.

Normally you won't run this alone — see `../docker-compose.yml`,
which wires it up together with the FastAPI orchestration service.
