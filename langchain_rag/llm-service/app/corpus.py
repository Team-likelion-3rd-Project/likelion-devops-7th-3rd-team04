"""RAG corpus: the documents `scripts/ingest.py` embeds and writes into the
S3 Vectors index, and what `retrieval.query_context` searches at query time.

Two kinds of documents, per the team's decision:
  1. The hotel/room data already seeded into MariaDB by
     `backend/scripts/seed.ts` (kept in sync by hand — copied here rather
     than queried live, so this stays a static, dependency-free corpus).
  2. A handful of hand-written hotel policy documents (check-in/out, pets,
     cancellation, breakfast) in the same style as the old "Mock RAG
     (placeholder)" n8n node's text, which this replaces.

Each entry's `id` is the S3 Vectors `key` (stable, so re-running the ingest
script upserts rather than duplicates).
"""

from typing import TypedDict


class Document(TypedDict):
    id: str
    text: str
    metadata: dict[str, str]


DOCUMENTS: list[Document] = [
    # --- Hotels/rooms, mirrors backend/scripts/seed.ts's HOTEL_SEEDS ---
    {
        "id": "hotel-seoul",
        "text": (
            "서울점 (서울 강남구 테헤란로 123, 02-1234-5678): 도심 속에서 누리는 조용한 휴식. "
            "디럭스 더블룸 - 시티뷰를 갖춘 넓은 더블룸입니다. (최대 2인)"
        ),
        "metadata": {"source": "hotel", "hotel": "서울점"},
    },
    {
        "id": "hotel-busan",
        "text": (
            "부산점 (부산 해운대구 해운대해변로 264, 051-1234-5678): 오션뷰와 함께하는 여유로운 시간. "
            "오션뷰 스위트룸 - 탁 트인 오션뷰를 자랑하는 스위트룸입니다. (최대 2인)"
        ),
        "metadata": {"source": "hotel", "hotel": "부산점"},
    },
    {
        "id": "hotel-jeju",
        "text": (
            "제주점 (제주 서귀포시 중문관광로72번길 100, 064-1234-5678): 자연 속 프라이빗한 힐링 스테이. "
            "가든뷰 트윈룸 - 아늑한 정원 전망의 트윈룸입니다. (최대 2인)"
        ),
        "metadata": {"source": "hotel", "hotel": "제주점"},
    },
    # --- Hotel policy documents ---
    {
        "id": "policy-checkin-checkout",
        "text": (
            "체크인/체크아웃 정책: 체크인은 오후 3시, 체크아웃은 오전 11시입니다. "
            "얼리 체크인/레이트 체크아웃은 객실 상황에 따라 가능할 수 있으니 프런트에 문의해주세요."
        ),
        "metadata": {"source": "policy", "topic": "checkin-checkout"},
    },
    {
        "id": "policy-pets",
        "text": (
            "반려동물 동반 정책: 반려동물 동반은 일부 객실(오션뷰 스위트룸 제외)에 한해 가능하며, "
            "1박당 추가 요금이 부과됩니다. 예약 시 반려동물 동반 여부를 미리 알려주세요."
        ),
        "metadata": {"source": "policy", "topic": "pets"},
    },
    {
        "id": "policy-cancellation",
        "text": (
            "취소/환불 정책: 체크인 3일 전까지 취소 시 전액 환불됩니다. "
            "그 이후 취소는 1박 요금이 위약금으로 부과되며, 노쇼(No-show)는 환불되지 않습니다."
        ),
        "metadata": {"source": "policy", "topic": "cancellation"},
    },
    {
        "id": "policy-breakfast-amenities",
        "text": (
            "조식/부대시설 안내: 모든 객실에 조식이 포함되어 있으며, 오전 7시부터 10시까지 "
            "1층 레스토랑에서 제공됩니다. 피트니스 센터와 스파는 투숙객이 무료로 이용할 수 있습니다."
        ),
        "metadata": {"source": "policy", "topic": "breakfast-amenities"},
    },
]
