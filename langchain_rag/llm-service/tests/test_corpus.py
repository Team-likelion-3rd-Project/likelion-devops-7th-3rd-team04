import json
from pathlib import Path

from app import corpus, intent

CATALOG = json.loads((Path(corpus.__file__).parent / "rag_catalog.json").read_text(encoding="utf-8"))


def test_document_ids_are_unique():
    ids = [doc["id"] for doc in corpus.DOCUMENTS]
    assert len(ids) == len(set(ids))


def test_every_document_is_tagged_with_a_hotel_slug_or_all():
    slugs = {hotel["slug"] for hotel in corpus.HOTELS}
    for doc in corpus.DOCUMENTS:
        assert doc["metadata"]["hotel"] in slugs | {corpus.ALL_HOTELS}, doc["id"]


def test_catalog_covers_every_hotel_room_and_notice():
    ids = {doc["id"] for doc in corpus.DOCUMENTS}
    for hotel in CATALOG["hotels"]:
        assert f"hotel-{hotel['slug']}" in ids
        for room in hotel["rooms"]:
            assert f"room-{hotel['slug']}-{room['slug']}" in ids
    assert sum(doc["metadata"]["source"] == "notice" for doc in corpus.DOCUMENTS) == len(CATALOG["notices"])


def test_room_document_has_weekday_and_weekend_rates():
    room = next(doc for doc in corpus.DOCUMENTS if doc["id"] == "room-seoul-deluxe-double")
    # seed-catalog.ts 요금표: 평일 120,000원, 주말 × 1.2
    assert "120,000원" in room["text"]
    assert "144,000원" in room["text"]


def test_pool_guide_matches_hotel_waters_page():
    guide = next(doc for doc in corpus.DOCUMENTS if doc["id"] == "facility-pool-guide")
    # frontend/src/pages/HotelWatersPage.tsx의 이용시간·요금
    for expected in ("09:00", "77,000원", "44,000원", "36개월 미만 무료"):
        assert expected in guide["text"]


def test_corpus_has_no_claims_missing_from_hotel_page():
    assert all("워터파크" not in doc["text"] for doc in corpus.DOCUMENTS)
    assert "policy-fitness-spa" not in {doc["id"] for doc in corpus.DOCUMENTS}


def test_intent_whitelist_follows_catalog():
    assert intent._ROOMS_BY_HOTEL == {
        hotel["slug"]: [room["name"] for room in hotel["rooms"]] for hotel in CATALOG["hotels"]
    }


def test_every_hotel_has_aliases_including_short_name():
    assert set(corpus.HOTEL_ALIASES) == {hotel["slug"] for hotel in corpus.HOTELS}
    assert "부산" in corpus.HOTEL_ALIASES["busan"]
    assert "해운대" in corpus.HOTEL_ALIASES["busan"]
