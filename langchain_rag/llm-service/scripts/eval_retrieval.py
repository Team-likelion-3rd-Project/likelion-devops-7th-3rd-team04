#!/usr/bin/env python3
"""RAG 검색 품질 점검과 유사도 임계값(RAG_MIN_SCORE) 보정.

app/corpus.py 문서와 아래 질문을 현재 임베딩 모델(LLM_PROVIDER)로 임베딩해 메모리에서 검색합니다 — 벡터
스토어는 쓰지 않으므로 인덱스 적재 없이 돌릴 수 있습니다. 지점 필터(retrieval.detect_hotels)도 같이 적용합니다.

  - 관련 질문: 기대 문서가 top-k 안에 드는지(hit@k)와 그 문서의 점수
  - 무관 질문(expected 없음): 가장 높은 점수 — 이보다 임계값이 높아야 엉뚱한 근거가 붙지 않습니다
임계값은 "관련 질문의 기대 문서 최저 점수"와 "무관 질문 최고 점수" 사이로 고르세요. 임베딩 모델이나 corpus를
크게 바꾸면 다시 돌립니다. Vertex 임베딩 호출 비용이 조금 듭니다.

    cd langchain_rag/llm-service
    LLM_PROVIDER=vertex GCP_SA_KEY_JSON="$(cat ../../infra/ansible/.secrets/llm-service-dev-sa.json)" \\
        python -m scripts.eval_retrieval
"""

import asyncio
import math

from app import config, retrieval
from app.corpus import ALL_HOTELS, DOCUMENTS

# (질문, 기대 문서 id 들 — 하나라도 top-k 에 들면 hit). 기대 문서가 없으면 무관 질문.
CASES: list[tuple[str, list[str]]] = [
    ("체크인 몇 시부터 가능해요?", ["policy-checkin-checkout"]),
    ("늦게 체크아웃 할 수 있나요?", ["policy-checkin-checkout"]),
    ("강아지 데리고 가도 되나요?", ["policy-pets"]),
    ("예약 취소하면 환불 받을 수 있어요?", ["policy-cancellation"]),
    ("조식 포함인가요? 몇 시까지 해요?", ["policy-breakfast"]),
    ("피트니스 센터 있어요?", ["policy-fitness-spa"]),
    ("수영장 이용 요금이 얼마예요?", ["facility-fees"]),
    ("라운지 추가하면 얼마 더 내야 해요?", ["facility-fees"]),
    ("결제는 언제까지 해야 하나요?", ["notice-2026-10-20-1"]),
    ("머묾이 무슨 뜻이에요? 브랜드 이름이 바뀌었나요?", ["notice-2026-10-23-1", "brand-about"]),
    ("일회용 칫솔 있나요?", ["brand-eco"]),
    ("주변에 산책할 만한 곳 있어요?", ["brand-nature"]),
    ("서울점 주소랑 전화번호 알려줘", ["hotel-seoul"]),
    ("부산점에 어떤 객실이 있어요?", ["hotel-busan"]),
    ("제주점 풀빌라 1박에 얼마예요?", ["room-jeju-private-poolvilla"]),
    ("해운대 오션뷰 스위트룸 몇 명까지 잘 수 있어요?", ["room-busan-oceanview-suite"]),
    ("서울점 패밀리룸 침대 구성 알려줘", ["room-seoul-family"]),
    ("4인 가족이 묵을 제주점 객실 추천해줘", ["room-jeju-family-suite"]),
    ("부산 스탠다드 더블룸 주말 요금", ["room-busan-standard-double"]),
    ("서울점 디럭스 더블룸에 커피머신 있어요?", ["room-seoul-deluxe-double"]),
    ("안녕하세요", []),
    ("고마워요!", []),
    ("오늘 날씨 어때?", []),
    ("파이썬으로 정렬 알고리즘 짜줘", []),
]


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    return dot / (math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b)))


async def main() -> None:
    doc_vectors = await retrieval.embed_documents([doc["text"] for doc in DOCUMENTS])
    top_k = config.RAG_TOP_K
    hits, relevant_scores, unrelated_scores = 0, [], []

    for question, expected in CASES:
        vector = await retrieval.embed_query(question)
        hotels = retrieval.detect_hotels(question)
        allowed = None if hotels is None else {*hotels, ALL_HOTELS}
        ranked = sorted(
            (
                (_cosine(vector, doc_vector), doc["id"])
                for doc, doc_vector in zip(DOCUMENTS, doc_vectors)
                if allowed is None or doc["metadata"]["hotel"] in allowed
            ),
            reverse=True,
        )[:top_k]
        shown = ", ".join(f"{doc_id}({score:.3f})" for score, doc_id in ranked)
        if expected:
            found = [score for score, doc_id in ranked if doc_id in expected]
            hits += bool(found)
            if found:
                relevant_scores.append(max(found))
            print(f"[{'HIT ' if found else 'MISS'}] {question}  filter={hotels}\n       {shown}")
        else:
            unrelated_scores.append(ranked[0][0])
            print(f"[NONE] {question}\n       {shown}")

    related = sum(1 for _, expected in CASES if expected)
    print(f"\nhit@{top_k}: {hits}/{related}")
    if relevant_scores:
        print(f"관련 질문의 기대 문서 최저 점수: {min(relevant_scores):.3f}")
    if unrelated_scores:
        print(f"무관 질문의 최고 점수:           {max(unrelated_scores):.3f}")
    print(f"현재 RAG_MIN_SCORE: {config.RAG_MIN_SCORE}")


if __name__ == "__main__":
    asyncio.run(main())
