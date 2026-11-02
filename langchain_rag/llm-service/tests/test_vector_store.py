import io
import json

import pytest

from app import config, vector_store
from app.vector_store import NoVectorStore, ObjectJsonStore, S3VectorsStore, SearchHit, create_store

MODEL = "vertex:text-multilingual-embedding-002"


def items():
    return [
        {"key": "a", "text": "체크인 3시", "metadata": {"source": "policy", "hotel": "all"}, "vector": [1.0, 0.0, 0.0]},
        {"key": "b", "text": "반려동물", "metadata": {"source": "policy", "hotel": "all"}, "vector": [0.0, 1.0, 0.0]},
        {"key": "c", "text": "조식", "metadata": {"source": "policy", "hotel": "all"}, "vector": [0.7, 0.7, 0.0]},
    ]


class FakeS3:
    """boto3 s3 클라이언트 중 ObjectJsonStore가 쓰는 메서드만 흉내 냅니다."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.version = 0
        self.gets = 0

    def put_object(self, Bucket, Key, Body, ContentType):
        self.version += 1
        self.objects[Key] = Body

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            raise KeyError(Key)
        return {"ETag": f'"v{self.version}"'}

    def get_object(self, Bucket, Key):
        self.gets += 1
        return {"Body": io.BytesIO(self.objects[Key])}


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def texts(hits):
    return [hit.text for hit in hits]


def object_store(s3, clock=None, model=MODEL):
    return ObjectJsonStore("rag-index", "rag/index.json", model, refresh_seconds=300, client=s3, clock=clock or Clock())


def test_object_store_round_trip_ranks_by_cosine():
    s3 = FakeS3()
    store = object_store(s3)
    store.replace_all(items())

    saved = json.loads(s3.objects["rag/index.json"])
    assert saved["embedding_model"] == MODEL
    assert saved["dimension"] == 3
    hits = store.query([1.0, 0.1, 0.0], top_k=2)
    assert texts(hits) == ["체크인 3시", "조식"]
    assert hits[0].key == "a" and hits[0].score > hits[1].score


def test_object_store_reloads_only_after_refresh_interval_and_etag_change():
    s3, clock = FakeS3(), Clock()
    writer, reader = object_store(s3), object_store(s3, clock)
    writer.replace_all(items())

    assert texts(reader.query([0.0, 1.0, 0.0], top_k=1)) == ["반려동물"]
    writer.replace_all([{"key": "d", "text": "새 문서", "metadata": {}, "vector": [0.0, 1.0, 0.0]}])

    clock.now = 100  # 아직 주기 전 — 이전 내용 그대로
    assert texts(reader.query([0.0, 1.0, 0.0], top_k=1)) == ["반려동물"]

    clock.now = 400  # 주기가 지나고 ETag가 바뀜 — 다시 읽음
    assert texts(reader.query([0.0, 1.0, 0.0], top_k=1)) == ["새 문서"]

    gets = s3.gets
    clock.now = 800  # ETag 그대로면 본문을 다시 받지 않음
    reader.query([0.0, 1.0, 0.0], top_k=1)
    assert s3.gets == gets


def test_object_store_rejects_index_built_with_other_embedding_model():
    s3 = FakeS3()
    object_store(s3, model="ollama:nomic-embed-text").replace_all(items())

    assert object_store(s3).query([1.0, 0.0, 0.0], top_k=3) == []


def test_object_store_filters_by_hotel_keeping_common_documents():
    s3 = FakeS3()
    store = object_store(s3)
    store.replace_all(
        [
            {"key": "seoul", "text": "서울점", "metadata": {"hotel": "seoul"}, "vector": [1.0, 0.0]},
            {"key": "busan", "text": "부산점", "metadata": {"hotel": "busan"}, "vector": [1.0, 0.0]},
            {"key": "policy", "text": "정책", "metadata": {"hotel": "all"}, "vector": [0.5, 0.5]},
        ]
    )

    assert texts(store.query([1.0, 0.0], top_k=3, hotels=["busan"])) == ["부산점", "정책"]
    assert len(store.query([1.0, 0.0], top_k=3)) == 3


def test_object_store_loaded_documents_reports_memory_state_only():
    s3 = FakeS3()
    object_store(s3).replace_all(items())
    reader = object_store(s3)

    assert reader.loaded_documents() is None  # 아직 읽지 않음 — /health가 저장소를 조회하지 않음
    assert s3.gets == 0
    reader.query([1.0, 0.0, 0.0], top_k=1)
    assert reader.loaded_documents() == 3


def test_object_store_rejected_index_reports_zero_documents():
    s3 = FakeS3()
    object_store(s3, model="ollama:nomic-embed-text").replace_all(items())
    reader = object_store(s3)
    reader.query([1.0, 0.0, 0.0], top_k=1)

    assert reader.loaded_documents() == 0


def test_object_store_rejects_query_with_other_dimension():
    s3 = FakeS3()
    store = object_store(s3)
    store.replace_all(items())

    assert store.query([1.0, 0.0], top_k=3) == []


def test_object_store_missing_file_raises_for_caller_to_handle():
    # retrieval.query_context가 예외를 잡아 RAG 없이 답변합니다.
    with pytest.raises(KeyError):
        object_store(FakeS3()).query([1.0, 0.0, 0.0], top_k=1)


class FakeS3Vectors:
    """boto3 s3vectors 클라이언트 흉내. stored 는 인덱스에 있는 key 들(list_vectors 는 page_size 씩 돌려줌)."""

    def __init__(self, stored=(), page_size=1000):
        self.calls = []
        self.stored = list(stored)
        self.page_size = page_size

    def query_vectors(self, **kwargs):
        self.calls.append(("query", kwargs))
        return {
            "vectors": [
                {"key": "a", "distance": 0.2, "metadata": {"text": "체크인 3시"}},
                {"key": "x", "distance": 0.1, "metadata": {}},
            ]
        }

    def put_vectors(self, **kwargs):
        self.calls.append(("put", kwargs))
        self.stored += [v["key"] for v in kwargs["vectors"] if v["key"] not in self.stored]

    def list_vectors(self, **kwargs):
        self.calls.append(("list", kwargs))
        start = int(kwargs.get("nextToken", 0))
        page = self.stored[start : start + self.page_size]
        more = start + self.page_size < len(self.stored)
        return {"vectors": [{"key": key} for key in page], **({"nextToken": str(start + self.page_size)} if more else {})}

    def delete_vectors(self, **kwargs):
        self.calls.append(("delete", kwargs))
        self.stored = [key for key in self.stored if key not in kwargs["keys"]]


def test_s3vectors_store_query_and_put_arguments():
    client = FakeS3Vectors()
    store = S3VectorsStore("bucket", "index", client=client)

    assert store.is_configured()
    # distance(cosine distance) → score(유사도) = 1 - distance, 원문이 없는 결과는 버림
    assert store.query([0.1, 0.2], top_k=3) == [SearchHit("a", "체크인 3시", 0.8)]
    store.replace_all(items()[:1])

    (_, query), (_, put), (_, _list) = client.calls
    assert query == {
        "vectorBucketName": "bucket",
        "indexName": "index",
        "topK": 3,
        "queryVector": {"float32": [0.1, 0.2]},
        "returnMetadata": True,
        "returnDistance": True,
    }
    assert put["vectors"] == [
        {
            "key": "a",
            "data": {"float32": [1.0, 0.0, 0.0]},
            "metadata": {"text": "체크인 3시", "source": "policy", "hotel": "all"},
        }
    ]


def test_s3vectors_store_query_filters_by_hotel_and_common_documents():
    client = FakeS3Vectors()
    S3VectorsStore("bucket", "index", client=client).query([0.1], top_k=3, hotels=["jeju"])

    (_, query), = client.calls
    assert query["filter"] == {"hotel": {"$in": ["jeju", "all"]}}


def test_s3vectors_replace_all_deletes_keys_missing_from_corpus():
    client = FakeS3Vectors(stored=["a", "old-1", "b", "old-2"], page_size=2)
    S3VectorsStore("bucket", "index", client=client).replace_all(items())

    assert sorted(client.stored) == ["a", "b", "c"]
    kinds = [kind for kind, _ in client.calls]
    # 넣은 다음에 지움 (검색 결과가 비는 순간이 없게), list 는 nextToken 으로 끝까지
    assert kinds == ["put", "list", "list", "list", "delete"]
    (_, delete), = [call for call in client.calls if call[0] == "delete"]
    assert delete["keys"] == ["old-1", "old-2"]


def test_s3vectors_replace_all_splits_batches_of_500():
    many = [{"key": f"k{i}", "text": "t", "metadata": {}, "vector": [1.0]} for i in range(1201)]
    client = FakeS3Vectors(stored=[f"stale{i}" for i in range(501)])
    S3VectorsStore("bucket", "index", client=client).replace_all(many)

    puts = [len(kwargs["vectors"]) for kind, kwargs in client.calls if kind == "put"]
    deletes = [len(kwargs["keys"]) for kind, kwargs in client.calls if kind == "delete"]
    assert puts == [500, 500, 201]
    assert deletes == [500, 1]


def test_s3vectors_store_without_bucket_is_not_configured():
    assert not S3VectorsStore(None, "index").is_configured()


@pytest.mark.parametrize(
    "name,expected",
    [("s3vectors", S3VectorsStore), ("object", ObjectJsonStore), ("none", NoVectorStore)],
)
def test_create_store_selects_implementation(monkeypatch, name, expected):
    monkeypatch.setattr(config, "VECTOR_STORE", name)
    monkeypatch.setattr(config, "VECTOR_BUCKET_NAME", None)
    assert isinstance(create_store(), expected)


def test_create_store_rejects_unknown(monkeypatch):
    monkeypatch.setattr(config, "VECTOR_STORE", "pinecone")
    with pytest.raises(ValueError):
        vector_store.create_store()
