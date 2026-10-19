"""RAG 코퍼스: scripts/ingest.py가 임베딩해 S3 Vectors 인덱스에 넣고,
retrieval.query_context가 질문 시점에 검색하는 문서들입니다.

  1. 호텔·객실·부대시설 — backend/scripts/seed.ts의 HOTEL_SEEDS/FACILITY_SEEDS를 손으로 옮긴
     정적 데이터입니다(런타임에 DB를 조회하지 않음). 날짜별로 바뀌는 객실 가격과 보유 수량은
     틀린 답의 근거가 될 수 있어 넣지 않습니다.
  2. 호텔 정책 — 체크인/아웃, 반려동물, 취소/환불, 조식/부대시설 안내.

seed.ts를 바꾸면 이 파일도 함께 고치고 `python -m scripts.ingest`를 다시 실행해야 챗봇에
반영됩니다. 각 문서의 `id`는 S3 Vectors의 `key`라 고정값이어야 합니다 — 다시 ingest하면
같은 key는 덮어쓰고(upsert), 사라진 id의 벡터는 인덱스에 남습니다.
"""

from typing import TypedDict


class Document(TypedDict):
    id: str
    text: str
    metadata: dict[str, str]


class _Room(TypedDict):
    slug: str
    name: str
    intro: str
    bedroom_count: int
    bed_config: str
    max_guests: int
    amenities: list[str]


class _Hotel(TypedDict):
    slug: str
    name: str
    address: str
    phone: str
    description: str
    rooms: list[_Room]


# --- seed.ts의 HOTEL_SEEDS와 동일하게 유지 ---
_HOTELS: list[_Hotel] = [
    {
        "slug": "seoul",
        "name": "서울점",
        "address": "서울 강남구 테헤란로 123",
        "phone": "02-1234-5678",
        "description": "도심 속에서 누리는 조용한 휴식",
        "rooms": [
            {
                "slug": "deluxe-double",
                "name": "디럭스 더블룸",
                "intro": "시티뷰를 갖춘 넓은 더블룸입니다.",
                "bedroom_count": 1,
                "bed_config": "킹사이즈 베드 1개",
                "max_guests": 2,
                "amenities": [
                    "무료 Wi-Fi", "43인치 스마트 TV", "미니바", "캡슐 커피머신", "헤어드라이어",
                    "다리미", "전자 금고", "욕실 어메니티(샴푸·린스·바디워시)",
                ],
            },
            {
                "slug": "standard-twin",
                "name": "스탠다드 트윈룸",
                "intro": "실용적인 구성의 스탠다드 트윈룸입니다.",
                "bedroom_count": 1,
                "bed_config": "싱글사이즈 베드 2개",
                "max_guests": 2,
                "amenities": ["무료 Wi-Fi", "32인치 TV", "냉장고", "전기 주전자", "헤어드라이어", "욕실 어메니티"],
            },
            {
                "slug": "premier-suite",
                "name": "프리미어 스위트룸",
                "intro": "넓은 거실 공간을 갖춘 프리미어 스위트룸입니다.",
                "bedroom_count": 1,
                "bed_config": "킹사이즈 베드 1개 + 별도 거실의 소파베드 1개",
                "max_guests": 3,
                "amenities": [
                    "무료 Wi-Fi", "55인치 스마트 TV", "미니바", "네스프레소 머신", "욕조",
                    "가운 & 슬리퍼", "전자 금고", "다리미",
                ],
            },
            {
                "slug": "family",
                "name": "패밀리룸",
                "intro": "가족 단위 투숙객을 위한 넉넉한 패밀리룸입니다.",
                "bedroom_count": 2,
                "bed_config": "퀸사이즈 베드 1개 + 싱글사이즈 베드 2개",
                "max_guests": 4,
                "amenities": [
                    "무료 Wi-Fi", "객실별 TV 2대", "냉장고", "전자레인지", "헤어드라이어",
                    "아기 침대 요청 가능", "욕실 어메니티",
                ],
            },
        ],
    },
    {
        "slug": "busan",
        "name": "부산점",
        "address": "부산 해운대구 해운대해변로 264",
        "phone": "051-1234-5678",
        "description": "오션뷰와 함께하는 여유로운 시간",
        "rooms": [
            {
                "slug": "oceanview-suite",
                "name": "오션뷰 스위트룸",
                "intro": "탁 트인 오션뷰를 자랑하는 스위트룸입니다.",
                "bedroom_count": 1,
                "bed_config": "킹사이즈 베드 1개 + 별도 거실",
                "max_guests": 2,
                "amenities": [
                    "오션뷰 발코니", "무료 Wi-Fi", "스마트 TV", "미니바", "욕조", "캡슐 커피머신",
                    "가운 & 슬리퍼",
                ],
            },
            {
                "slug": "standard-double",
                "name": "스탠다드 더블룸",
                "intro": "아늑한 구성의 스탠다드 더블룸입니다.",
                "bedroom_count": 1,
                "bed_config": "더블사이즈 베드 1개",
                "max_guests": 2,
                "amenities": ["무료 Wi-Fi", "TV", "냉장고", "헤어드라이어", "욕실 어메니티"],
            },
            {
                "slug": "premium-oceanview",
                "name": "프리미엄 오션뷰룸",
                "intro": "파노라마 오션뷰를 즐길 수 있는 프리미엄룸입니다.",
                "bedroom_count": 1,
                "bed_config": "킹사이즈 베드 1개 + 싱글 소파베드 1개",
                "max_guests": 3,
                "amenities": [
                    "통유리 오션뷰 창", "전용 발코니", "무료 Wi-Fi", "스마트 TV", "미니바",
                    "캡슐 커피머신", "욕조",
                ],
            },
            {
                "slug": "family-twin",
                "name": "패밀리 트윈룸",
                "intro": "가족 여행객을 위한 넓은 패밀리 트윈룸입니다.",
                "bedroom_count": 2,
                "bed_config": "더블사이즈 베드 1개 + 싱글사이즈 베드 2개",
                "max_guests": 4,
                "amenities": [
                    "오션뷰 발코니", "무료 Wi-Fi", "객실별 TV 2대", "냉장고", "전자레인지", "욕실 어메니티",
                ],
            },
        ],
    },
    {
        "slug": "jeju",
        "name": "제주점",
        "address": "제주 서귀포시 중문관광로72번길 100",
        "phone": "064-1234-5678",
        "description": "자연 속 프라이빗한 힐링 스테이",
        "rooms": [
            {
                "slug": "gardenview-twin",
                "name": "가든뷰 트윈룸",
                "intro": "아늑한 정원 전망의 트윈룸입니다.",
                "bedroom_count": 1,
                "bed_config": "싱글사이즈 베드 2개",
                "max_guests": 2,
                "amenities": ["정원뷰 창", "무료 Wi-Fi", "TV", "냉장고", "헤어드라이어", "욕실 어메니티"],
            },
            {
                "slug": "standard-double",
                "name": "스탠다드 더블룸",
                "intro": "제주의 자연을 가까이 느낄 수 있는 스탠다드룸입니다.",
                "bedroom_count": 1,
                "bed_config": "더블사이즈 베드 1개",
                "max_guests": 2,
                "amenities": ["무료 Wi-Fi", "TV", "냉장고", "전기 주전자", "욕실 어메니티"],
            },
            {
                "slug": "private-poolvilla",
                "name": "프라이빗 풀빌라룸",
                "intro": "독립적인 야외 풀을 갖춘 프라이빗 풀빌라룸입니다.",
                "bedroom_count": 1,
                "bed_config": "킹사이즈 베드 1개",
                "max_guests": 3,
                "amenities": [
                    "프라이빗 야외 수영장", "전용 테라스", "무료 Wi-Fi", "스마트 TV", "미니바", "가운 & 슬리퍼",
                ],
            },
            {
                "slug": "family-suite",
                "name": "패밀리 스위트룸",
                "intro": "넓은 공간의 패밀리 스위트룸입니다.",
                "bedroom_count": 2,
                "bed_config": "퀸사이즈 베드 1개 + 싱글사이즈 베드 2개",
                "max_guests": 4,
                "amenities": [
                    "정원뷰 테라스", "무료 Wi-Fi", "객실별 TV 2대", "냉장고", "전자레인지 & 전기 주전자",
                    "욕실 어메니티",
                ],
            },
        ],
    },
]

# --- seed.ts의 FACILITY_SEEDS와 동일하게 유지 ---
_FACILITIES: list[tuple[str, int]] = [("수영장", 30000), ("라운지", 50000)]


def _hotel_document(hotel: _Hotel) -> Document:
    room_names = ", ".join(room["name"] for room in hotel["rooms"])
    return {
        "id": f"hotel-{hotel['slug']}",
        "text": (
            f"{hotel['name']} ({hotel['address']}, {hotel['phone']}): {hotel['description']}. "
            f"객실 타입: {room_names}."
        ),
        "metadata": {"source": "hotel", "hotel": hotel["name"]},
    }


def _room_document(hotel: _Hotel, room: _Room) -> Document:
    return {
        "id": f"room-{hotel['slug']}-{room['slug']}",
        "text": (
            f"{hotel['name']} {room['name']}: {room['intro']} "
            f"침실 {room['bedroom_count']}개({room['bed_config']}), 최대 {room['max_guests']}명. "
            f"제공 어메니티: {', '.join(room['amenities'])}."
        ),
        "metadata": {"source": "room", "hotel": hotel["name"], "room": room["name"]},
    }


def _facility_document() -> Document:
    fees = ", ".join(f"{name} {price:,}원" for name, price in _FACILITIES)
    return {
        "id": "facility-fees",
        "text": f"부대시설 이용 요금(예약 시 추가 선택): {fees}.",
        "metadata": {"source": "facility"},
    }


_POLICY_DOCUMENTS: list[Document] = [
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

DOCUMENTS: list[Document] = [
    *(_hotel_document(hotel) for hotel in _HOTELS),
    *(_room_document(hotel, room) for hotel in _HOTELS for room in hotel["rooms"]),
    _facility_document(),
    *_POLICY_DOCUMENTS,
]
