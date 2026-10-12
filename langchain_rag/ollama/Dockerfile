# Self-hosted Ollama node with the model pre-baked into the image.
#
# Rationale: the eventual deployment target is the EKS GPU node group
# (infra/terraform/modules/eks — g4dn.xlarge, 1x NVIDIA T4, 16GB VRAM),
# which is scaled to 0 by default and only spins a node up on demand.
# Pulling multi-GB model weights at pod startup would make every cold
# scale-up slow, so the model is pulled once at *build* time and shipped
# as part of the image instead. See ../README.md and ./README.md for more.
#
# Deploying this image (ECR push, Helm/ArgoCD, GPU scheduling/autoscaling)
# is out of scope here — see CLAUDE.md's "Chatbot / AI subsystem" section.

ARG OLLAMA_VERSION=0.3.14
FROM ollama/ollama:${OLLAMA_VERSION}

# Model tag to bake in. Override at build time for local/CPU-only testing
# with something smaller, e.g.:
#   docker build --build-arg OLLAMA_MODEL=qwen2.5:0.5b-instruct -t local/ollama-hotel .
ARG OLLAMA_MODEL=qwen2.5:7b-instruct

# Embedding model for RAG (S3 Vectors retrieval, see llm-service/app/retrieval.py).
# nomic-embed-text outputs 768-dim vectors — infra/terraform/modules/ai_data's
# vector_dimension must match (separate Terraform branch). Same ollama instance
# serves both this and the chat model above; callers pick one via the `model`
# field on each request.
ARG OLLAMA_EMBED_MODEL=nomic-embed-text
ENV OLLAMA_MODEL=${OLLAMA_MODEL} \
    OLLAMA_EMBED_MODEL=${OLLAMA_EMBED_MODEL} \
    OLLAMA_HOST=0.0.0.0:11434

# Start the server just long enough to pull both models into this layer, then
# stop it — the image ships with the models already present on disk, so the
# real `ollama serve` at container start does no network pulling.
RUN ollama serve & \
    OLLAMA_PID=$! && \
    sleep 3 && \
    for model in "${OLLAMA_MODEL}" "${OLLAMA_EMBED_MODEL}"; do \
        success=0; \
        for i in 1 2 3 4 5 6 7 8 9 10; do \
            if ollama pull "${model}"; then success=1; break; fi; \
            sleep 3; \
        done; \
        if [ "${success}" != "1" ]; then echo "failed to pull ${model}" >&2; exit 1; fi; \
    done && \
    kill "${OLLAMA_PID}"

EXPOSE 11434
ENTRYPOINT ["ollama", "serve"]
