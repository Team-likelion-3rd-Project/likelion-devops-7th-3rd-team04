import io
import json

import pytest

from app import config, vector_store
from app.vector_store import NoVectorStore, ObjectJsonStore, S3VectorsStore, create_store

MODEL = "vertex:text-multilingual-embedding-002"


def items():
    return [
        {"key": "a", "text": "체크인 3시", "metadata": {"source": "policy"}, "vector": [1.0, 0.0, 0.0]},
        {"key": "b", "text": "반려동물", "metadata": {"source": "policy"}, "vector": [0.0, 1.0, 0.0]},
        {"key": "c", "text": "조식", "metadata": {"source": "policy"}, "vector": [0.7, 0.7, 0.0]},
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


def object_store(s3, clock=None, model=MODEL):
    return ObjectJsonStore("rag-index", "rag/index.json", model, refresh_seconds=300, client=s3, clock=clock or Clock())


def test_object_store_round_trip_ranks_by_cosine():
    s3 = FakeS3()
    store = object_store(s3)
    store.replace_all(items())

    saved = json.loads(s3.objects["rag/index.json"])
    assert saved["embedding_model"] == MODEL
    assert saved["dimension"] == 3
    assert store.query([1.0, 0.1, 0.0], top_k=2) == ["체크인 3시", "조식"]


def test_object_store_reloads_only_after_refresh_interval_and_etag_change():
    s3, clock = FakeS3(), Clock()
    writer, reader = object_store(s3), object_store(s3, clock)
    writer.replace_all(items())

    assert reader.query([0.0, 1.0, 0.0], top_k=1) == ["반려동물"]
    writer.replace_all([{"key": "d", "text": "새 문서", "metadata": {}, "vector": [0.0, 1.0, 0.0]}])

    clock.now = 100  # 아직 주기 전 — 이전 내용 그대로
    assert reader.query([0.0, 1.0, 0.0], top_k=1) == ["반려동물"]

    clock.now = 400  # 주기가 지나고 ETag가 바뀜 — 다시 읽음
    assert reader.query([0.0, 1.0, 0.0], top_k=1) == ["새 문서"]

    gets = s3.gets
    clock.now = 800  # ETag 그대로면 본문을 다시 받지 않음
    reader.query([0.0, 1.0, 0.0], top_k=1)
    assert s3.gets == gets


def test_object_store_rejects_index_built_with_other_embedding_model():
    s3 = FakeS3()
    object_store(s3, model="ollama:nomic-embed-text").replace_all(items())

    assert object_store(s3).query([1.0, 0.0, 0.0], top_k=3) == []


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
    def __init__(self):
        self.calls = []

    def query_vectors(self, **kwargs):
        self.calls.append(("query", kwargs))
        return {"vectors": [{"metadata": {"text": "체크인 3시"}}, {"metadata": {}}]}

    def put_vectors(self, **kwargs):
        self.calls.append(("put", kwargs))


def test_s3vectors_store_query_and_put_arguments():
    client = FakeS3Vectors()
    store = S3VectorsStore("bucket", "index", client=client)

    assert store.is_configured()
    assert store.query([0.1, 0.2], top_k=3) == ["체크인 3시"]
    store.replace_all(items()[:1])

    (_, query), (_, put) = client.calls
    assert query == {
        "vectorBucketName": "bucket",
        "indexName": "index",
        "topK": 3,
        "queryVector": {"float32": [0.1, 0.2]},
        "returnMetadata": True,
        "returnDistance": True,
    }
    assert put["vectors"] == [
        {"key": "a", "data": {"float32": [1.0, 0.0, 0.0]}, "metadata": {"text": "체크인 3시", "source": "policy"}}
    ]


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
