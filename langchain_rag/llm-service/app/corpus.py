"""RAG 코퍼스: scripts/ingest.py가 임베딩해 벡터 스토어에 넣고, retrieval.query_context가 질문 시점에
검색하는 문서들입니다.

  1. 호텔·객실·부대시설·공지 — app/rag_catalog.json(생성 파일)에서 만듭니다. 원본은 DB 시딩과 같은
     backend/scripts/seed-catalog.ts이며, 바꾸면 `cd backend && npm run rag:export-catalog`로 JSON을 다시
     만들어야 합니다(backend CI의 scripts/export-rag-catalog.spec.ts가 어긋나면 실패). 런타임에 DB는 조회하지
     않습니다. 객실 요금은 요금표(평일 기준 · 주말 배율)만 넣고, 날짜별 실제 금액은 예약 화면에서 확인하도록 안내합니다.
  2. 브랜드 소개 — frontend/src/data/brandValues.ts(브랜드 가치 페이지)를 요약해 손으로 적었습니다.
  3. 호텔 정책 — 체크인/아웃, 반려동물, 취소/환불, 조식/부대시설 안내.

모든 문서는 metadata `hotel`에 지점 slug(지점 전용 문서) 또는 "all"(공통 문서)을 가집니다 — 질문에 지점이
나오면 retrieval이 그 지점 + 공통 문서로만 검색합니다. 각 문서의 `id`는 벡터 스토어의 key라 고정값이어야
하고, 다시 ingest하면 같은 key는 덮어쓰고 corpus에서 사라진 key는 지웁니다(vector_store.replace_all).
"""

import json
from pathlib import Path
from typing import TypedDict

ALL_HOTELS = "all"


class Document(TypedDict):
    id: str
    text: str
    metadata: dict[str, str]


class _Room(TypedDict):
    slug: str
    name: str
    weekdayPrice: int
    intro: str
    bedroomCount: int
    bedConfig: str
    maxGuests: int
    amenities: list[str]


class _Hotel(TypedDict):
    slug: str
    name: str
    address: str
    phone: str
    description: str
    rooms: list[_Room]


class _Facility(TypedDict):
    name: str
    price: int


class _Notice(TypedDict):
    date: str
    category: str
    title: str
    body: str


_CATALOG = json.loads((Path(__file__).parent / "rag_catalog.json").read_text(encoding="utf-8"))

# app/intent.py도 지점 slug·객실명 화이트리스트로 씁니다.
HOTELS: list[_Hotel] = _CATALOG["hotels"]
_FACILITIES: list[_Facility] = _CATALOG["facilities"]
_NOTICES: list[_Notice] = _CATALOG["notices"]
_WEEKEND_PRICE_RATE: float = _CATALOG["weekendPriceRate"]

BRAND = "머묾"

# 질문에서 지점을 알아보는 키워드(retrieval.detect_hotels). 지점명과 "점"을 뗀 이름은 자동으로 더합니다.
_EXTRA_ALIASES: dict[str, list[str]] = {
    "seoul": ["강남", "테헤란로", "남산"],
    "busan": ["해운대"],
    "jeju": ["서귀포", "중문"],
}
HOTEL_ALIASES: dict[str, list[str]] = {
    hotel["slug"]: [hotel["name"], hotel["name"].removesuffix("점"), *_EXTRA_ALIASES.get(hotel["slug"], [])]
    for hotel in HOTELS
}


def _won(amount: float) -> str:
    return f"{round(amount):,}원"


def _hotel_document(hotel: _Hotel) -> Document:
    room_names = ", ".join(room["name"] for room in hotel["rooms"])
    return {
        "id": f"hotel-{hotel['slug']}",
        "text": (
            f"{BRAND} {hotel['name']} — 주소: {hotel['address']}, 전화: {hotel['phone']}. "
            f"{hotel['description']}. 객실 타입: {room_names}."
        ),
        "metadata": {"source": "hotel", "hotel": hotel["slug"]},
    }


def _room_document(hotel: _Hotel, room: _Room) -> Document:
    weekday = room["weekdayPrice"]
    return {
        "id": f"room-{hotel['slug']}-{room['slug']}",
        "text": (
            f"{BRAND} {hotel['name']} {room['name']}: {room['intro']} "
            f"침실 {room['bedroomCount']}개({room['bedConfig']}), 최대 {room['maxGuests']}명. "
            f"제공 어메니티: {', '.join(room['amenities'])}. "
            f"기준 요금: 평일(일~목요일 밤 숙박) 1박 {_won(weekday)}, "
            f"주말(금·토요일 밤 숙박) 1박 {_won(weekday * _WEEKEND_PRICE_RATE)}. "
            "날짜에 따라 요금이 달라질 수 있어 정확한 금액은 예약 화면에서 확인할 수 있습니다."
        ),
        "metadata": {"source": "room", "hotel": hotel["slug"], "room": room["name"]},
    }


def _facility_document() -> Document:
    fees = ", ".join(f"{facility['name']} {_won(facility['price'])}" for facility in _FACILITIES)
    return {
        "id": "facility-fees",
        "text": f"부대시설 이용 요금(예약 시 옵션으로 추가 선택, 모든 지점 동일): {fees}.",
        "metadata": {"source": "facility", "hotel": ALL_HOTELS},
    }


def _notice_documents() -> list[Document]:
    documents: list[Document] = []
    seen: dict[str, int] = {}
    for notice in _NOTICES:
        # 같은 날짜 공지가 여러 건이어도 key가 겹치지 않게 날짜별 순번을 붙입니다.
        seen[notice["date"]] = seen.get(notice["date"], 0) + 1
        documents.append(
            {
                "id": f"notice-{notice['date']}-{seen[notice['date']]}",
                "text": f"[공지 {notice['date']}] {notice['title']}: {notice['body']}",
                "metadata": {"source": "notice", "hotel": ALL_HOTELS},
            }
        )
    return documents


# frontend/src/data/brandValues.ts(브랜드 가치 페이지) 요약 — 그 파일을 바꾸면 여기도 맞춰 주세요.
_BRAND_DOCUMENTS: list[Document] = [
    {
        "id": "brand-about",
        "text": (
            f"브랜드 소개: 호텔 브랜드명은 '{BRAND}(MEOMULM)'이며 서울점·부산점·제주점 세 지점을 운영합니다. "
            "모든 객실은 그 도시의 풍경을 향합니다 — 서울점은 남산, 부산점은 바다, 제주점은 오름과 숲. "
            "두꺼운 벽과 이중창으로 조용한 밤을 보낼 수 있고, 조명·커튼·온도는 머리맡 패널 하나로 조절합니다."
        ),
        "metadata": {"source": "brand", "hotel": ALL_HOTELS},
    },
    {
        "id": "brand-nature",
        "text": (
            "자연과 산책: 세 지점 모두 수영장과 라운지를 갖추고 있습니다. 체크인 때 지점 주변 산책길 지도"
            "(남산 둘레길, 해운대 해변, 제주 숲길)를 드립니다. 로비와 테라스에는 지역의 나무와 풀을 심었습니다."
        ),
        "metadata": {"source": "brand", "hotel": ALL_HOTELS},
    },
    {
        "id": "brand-eco",
        "text": (
            "친환경 운영: 객실 어메니티는 다회용 디스펜서로, 생수는 유리병으로 제공합니다. 칫솔·면도기는 "
            "요청하시는 분께만 드립니다. 객실을 비우면 조명과 냉난방이 절전 모드로 바뀝니다. "
            "조식과 라운지 메뉴는 가까운 지역 농가·어가의 재료로 만듭니다."
        ),
        "metadata": {"source": "brand", "hotel": ALL_HOTELS},
    },
]

_POLICY_DOCUMENTS: list[Document] = [
    {
        "id": "policy-checkin-checkout",
        "text": (
            "체크인/체크아웃 정책: 체크인은 오후 3시, 체크아웃은 오전 11시입니다. "
            "얼리 체크인/레이트 체크아웃은 객실 상황에 따라 가능할 수 있으니 지점 프런트에 문의해주세요."
        ),
        "metadata": {"source": "policy", "topic": "checkin-checkout", "hotel": ALL_HOTELS},
    },
    {
        "id": "policy-pets",
        "text": (
            "반려동물 동반 정책: 반려동물 동반은 일부 객실(부산점 오션뷰 스위트룸 제외)에 한해 가능하며, "
            "1박당 추가 요금이 있습니다. 추가 요금과 가능한 객실은 예약 전에 지점에 문의해주세요."
        ),
        "metadata": {"source": "policy", "topic": "pets", "hotel": ALL_HOTELS},
    },
    {
        "id": "policy-cancellation",
        "text": (
            "취소/환불 정책: 결제 전(결제 대기) 예약은 취소 즉시 예약이 해제되며, "
            "결제를 완료한 예약은 취소 시 결제 금액 전액이 환불됩니다. 취소는 마이페이지의 예약 상세나 챗봇에서 할 수 있습니다."
        ),
        "metadata": {"source": "policy", "topic": "cancellation", "hotel": ALL_HOTELS},
    },
    {
        "id": "policy-breakfast",
        "text": (
            "조식 안내: 모든 객실에 조식이 포함되어 있으며, 오전 7시부터 10시까지 1층 레스토랑에서 제공됩니다."
        ),
        "metadata": {"source": "policy", "topic": "breakfast", "hotel": ALL_HOTELS},
    },
    {
        "id": "policy-fitness-spa",
        "text": "피트니스 센터·스파 안내: 피트니스 센터(헬스장)와 스파는 투숙객이 무료로 이용할 수 있습니다.",
        "metadata": {"source": "policy", "topic": "fitness-spa", "hotel": ALL_HOTELS},
    },
]

DOCUMENTS: list[Document] = [
    *(_hotel_document(hotel) for hotel in HOTELS),
    *(_room_document(hotel, room) for hotel in HOTELS for room in hotel["rooms"]),
    _facility_document(),
    *_notice_documents(),
    *_BRAND_DOCUMENTS,
    *_POLICY_DOCUMENTS,
]
