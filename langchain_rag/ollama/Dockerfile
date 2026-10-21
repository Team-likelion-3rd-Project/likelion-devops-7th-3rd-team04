# 채팅/임베딩 모델을 빌드 시점에 미리 받아 둔 Ollama 이미지.
# 컨테이너 기동 때 수 GB짜리 모델을 내려받지 않도록 pull을 이미지 레이어에 포함합니다.
# 자세한 내용은 ./README.md 참고.

ARG OLLAMA_VERSION=0.3.14
FROM ollama/ollama:${OLLAMA_VERSION}

# 미리 받아 둘 채팅 모델. CPU 전용 로컬 테스트에는 작은 모델로 바꿀 수 있습니다:
#   docker build --build-arg OLLAMA_MODEL=qwen2.5:0.5b-instruct -t local/ollama-hotel .
ARG OLLAMA_MODEL=qwen2.5:7b-instruct

# RAG용 임베딩 모델(llm-service/app/retrieval.py). nomic-embed-text는 768차원이라
# S3 Vectors 인덱스 차원과 맞아야 합니다. 같은 Ollama가 두 모델을 모두 서빙하며,
# 호출자가 요청의 `model` 필드로 고릅니다.
ARG OLLAMA_EMBED_MODEL=nomic-embed-text
ENV OLLAMA_MODEL=${OLLAMA_MODEL} \
    OLLAMA_EMBED_MODEL=${OLLAMA_EMBED_MODEL} \
    OLLAMA_HOST=0.0.0.0:11434

# 두 모델을 이 레이어에 받기 위해 잠시 서버를 띄웠다가 종료합니다 — 이미지에 모델이
# 이미 들어 있으므로 실제 컨테이너 기동 시의 `ollama serve`는 네트워크에서 받지 않습니다.
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
