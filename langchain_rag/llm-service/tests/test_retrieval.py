import asyncio

import pytest

from app import config, retrieval
from app.vector_store import SearchHit


class FakeStore:
    def __init__(self, hits=None, error=None):
        self.hits = hits or []
        self.error = error
        self.calls = []

    def is_configured(self):
        return True

    def query(self, vector, top_k, hotels=None):
        self.calls.append({"top_k": top_k, "hotels": hotels})
        if self.error:
            raise self.error
        return self.hits


@pytest.fixture
def fake_store(monkeypatch):
    def install(store):
        monkeypatch.setattr(retrieval, "store", lambda: store)

        async def embed(text):
            return [0.1, 0.2]

        monkeypatch.setattr(retrieval, "embed_query", embed)
        monkeypatch.setattr(config, "RAG_MIN_SCORE", 0.5)
        return store

    return install


@pytest.mark.parametrize(
    "message,expected",
    [
        ("해운대 쪽 지점 주차 돼요?", ["busan"]),
        ("서울점이랑 제주 중에 어디가 조용해요?", ["seoul", "jeju"]),
        ("체크인 몇 시예요?", None),
    ],
)
def test_detect_hotels(message, expected):
    assert retrieval.detect_hotels(message) == expected


def test_query_context_drops_hits_below_min_score_and_passes_hotel_filter(fake_store):
    store = fake_store(FakeStore([SearchHit("a", "부산점 안내", 0.8), SearchHit("b", "관련 없음", 0.3)]))

    context = asyncio.run(retrieval.query_context("부산점 위치 알려줘"))

    assert context == "부산점 안내"
    assert store.calls == [{"top_k": config.RAG_TOP_K, "hotels": ["busan"]}]


def test_query_context_returns_none_when_nothing_is_relevant(fake_store):
    fake_store(FakeStore([SearchHit("a", "체크인 안내", 0.2)]))

    assert asyncio.run(retrieval.query_context("안녕하세요")) is None


def test_query_context_returns_none_on_store_error(fake_store):
    fake_store(FakeStore(error=RuntimeError("AccessDenied")))

    assert asyncio.run(retrieval.query_context("체크인 몇 시예요?")) is None
