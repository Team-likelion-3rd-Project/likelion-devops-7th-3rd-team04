"""RAG 벡터 스토어. VECTOR_STORE로 구현을 고릅니다.

- s3vectors (prod): AWS S3 Vectors 인덱스. 인증은 EKS Pod Identity 등 boto3 기본 자격 증명 체인.
- object (dev): S3 호환 객체 저장소(온프레미스 MinIO)에 임베딩 JSON 파일 하나를 두고, 메모리에 올려
  코사인 유사도로 검색합니다. 문서 수가 수천 건 이하면 별도 벡터 DB 없이 충분합니다.
- none: RAG를 쓰지 않습니다.

boto3 `s3vectors` 클라이언트 API (boto3==1.43.73 기준 확인 — AWS가 API를 바꾸면 여기부터 확인):
  - put_vectors(vectorBucketName, indexName, vectors=[
        {"key": str, "data": {"float32": [float, ...]}, "metadata": {...}},
    ])
  - query_vectors(vectorBucketName, indexName, topK, queryVector={"float32": [...]},
        filter={"hotel": {"$in": [...]}}, returnMetadata=True, returnDistance=True)
    -> {"vectors": [{"key", "distance", "metadata"}], "distanceMetric", "nextToken"}
    distance는 cosine distance(= 1 - 코사인 유사도)라 SearchHit.score = 1 - distance 로 바꿉니다.
  - list_vectors(vectorBucketName, indexName, maxResults<=1000, nextToken) -> {"vectors": [{"key"}], "nextToken"}
  - delete_vectors(vectorBucketName, indexName, keys=[...])   # put·delete 는 한 번에 최대 500개

object 스토어의 파일 형식:
  {"embedding_model": "vertex:text-multilingual-embedding-002", "dimension": 768, "created_at": "...",
   "items": [{"key": str, "text": str, "metadata": {...}, "vector": [float, ...]}]}
embedding_model·dimension이 현재 설정과 다르면 로드를 거부합니다 — 모델을 바꾸고 다시 ingest하지
않았을 때 엉뚱한 문서가 검색되는 것을 막기 위함입니다.

지점 필터: 문서 metadata `hotel`은 지점 slug 또는 "all"(공통 문서)입니다. query(hotels=[...])는 그 지점들과
공통 문서만 검색합니다.
"""

import json
import logging
import math
import threading
import time
from datetime import datetime, timezone
from typing import NamedTuple, Protocol, TypedDict

import boto3

from . import config, llm

logger = logging.getLogger(__name__)

# 공통 문서의 metadata hotel 값 (app/corpus.py ALL_HOTELS 와 같음)
ALL_HOTELS = "all"
# S3 Vectors PutVectors · DeleteVectors 한 번에 넣을 수 있는 최대 개수
S3VECTORS_BATCH_SIZE = 500


class VectorItem(TypedDict):
    key: str
    text: str
    metadata: dict[str, str]
    vector: list[float]


class SearchHit(NamedTuple):
    key: str
    text: str
    # 코사인 유사도. 클수록 가깝습니다(retrieval이 RAG_MIN_SCORE 미만을 버림).
    score: float


class VectorStore(Protocol):
    def is_configured(self) -> bool: ...

    def query(self, vector: list[float], top_k: int, hotels: list[str] | None = None) -> list[SearchHit]:
        """가까운 순으로 top_k개를 돌려줍니다. hotels가 있으면 그 지점과 공통("all") 문서만 검색합니다."""
        ...

    def replace_all(self, items: list[VectorItem]) -> None:
        """ingest용. 인덱스를 정확히 items로 맞춥니다(같은 key는 덮어쓰고, items에 없는 key는 지움)."""
        ...


def _hotel_values(hotels: list[str]) -> list[str]:
    return [*hotels, ALL_HOTELS]


def _batches(values: list, size: int = S3VECTORS_BATCH_SIZE):
    for start in range(0, len(values), size):
        yield values[start : start + size]


class S3VectorsStore:
    def __init__(self, bucket: str | None, index: str | None, client=None):
        self.bucket = bucket
        self.index = index
        # VECTOR_BUCKET_NAME이 없으면(AWS 없는 로컬 개발) 클라이언트를 만들지 않습니다.
        self._client = client or (boto3.client("s3vectors", region_name=config.AWS_REGION) if bucket else None)

    def is_configured(self) -> bool:
        return self._client is not None and bool(self.bucket) and bool(self.index)

    def query(self, vector: list[float], top_k: int, hotels: list[str] | None = None) -> list[SearchHit]:
        options = {"filter": {"hotel": {"$in": _hotel_values(hotels)}}} if hotels else {}
        response = self._client.query_vectors(
            vectorBucketName=self.bucket,
            indexName=self.index,
            topK=top_k,
            queryVector={"float32": vector},
            returnMetadata=True,
            returnDistance=True,
            **options,
        )
        return [
            SearchHit(m["key"], m["metadata"]["text"], 1.0 - m["distance"])
            for m in response.get("vectors", [])
            if m.get("metadata", {}).get("text")
        ]

    def replace_all(self, items: list[VectorItem]) -> None:
        # 넣은 다음에 지웁니다 — 순서를 반대로 하면 적재 중에 검색 결과가 비는 순간이 생깁니다.
        for batch in _batches(items):
            self._client.put_vectors(
                vectorBucketName=self.bucket,
                indexName=self.index,
                vectors=[
                    {
                        "key": item["key"],
                        "data": {"float32": item["vector"]},
                        # 원문을 metadata에 같이 실어 query()가 추가 조회 없이 바로 돌려줄 수 있게 합니다.
                        "metadata": {"text": item["text"], **item["metadata"]},
                    }
                    for item in batch
                ],
            )
        keep = {item["key"] for item in items}
        stale = [key for key in self._list_keys() if key not in keep]
        for batch in _batches(stale):
            self._client.delete_vectors(vectorBucketName=self.bucket, indexName=self.index, keys=batch)
        if stale:
            logger.info("corpus에 없는 벡터 %d건을 지웠습니다: %s", len(stale), ", ".join(stale))

    def _list_keys(self) -> list[str]:
        keys: list[str] = []
        options: dict[str, str] = {}
        while True:
            response = self._client.list_vectors(
                vectorBucketName=self.bucket, indexName=self.index, maxResults=1000, **options
            )
            keys.extend(vector["key"] for vector in response.get("vectors", []))
            if not response.get("nextToken"):
                return keys
            options = {"nextToken": response["nextToken"]}


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class ObjectJsonStore:
    def __init__(
        self,
        bucket: str | None,
        key: str,
        embedding_model: str,
        refresh_seconds: int = 300,
        client=None,
        clock=time.monotonic,
    ):
        self.bucket = bucket
        self.key = key
        self.embedding_model = embedding_model
        self.refresh_seconds = refresh_seconds
        self._client = client
        self._clock = clock
        self._lock = threading.Lock()
        self._items: list[VectorItem] = []
        self._etag: str | None = None
        self._checked_at: float | None = None

    def _s3(self):
        if self._client is None:
            self._client = boto3.client(
                "s3",
                endpoint_url=config.VECTOR_OBJECT_ENDPOINT,
                region_name=config.VECTOR_OBJECT_REGION,
                aws_access_key_id=config.VECTOR_OBJECT_ACCESS_KEY,
                aws_secret_access_key=config.VECTOR_OBJECT_SECRET_KEY,
            )
        return self._client

    def is_configured(self) -> bool:
        return bool(self.bucket)

    def loaded_documents(self) -> int | None:
        """/health용. 메모리에 올라간 문서 수 — 아직 한 번도 읽지 않았으면 None. 저장소를 조회하지 않습니다."""
        with self._lock:
            return None if self._etag is None else len(self._items)

    def _refresh(self) -> None:
        """refresh_seconds마다 ETag를 확인해 파일이 바뀌었을 때만 다시 읽습니다."""
        now = self._clock()
        if self._checked_at is not None and now - self._checked_at < self.refresh_seconds:
            return
        self._checked_at = now
        etag = self._s3().head_object(Bucket=self.bucket, Key=self.key)["ETag"]
        if etag == self._etag:
            return
        body = self._s3().get_object(Bucket=self.bucket, Key=self.key)["Body"].read()
        data = json.loads(body)
        if data.get("embedding_model") != self.embedding_model:
            self._items, self._etag = [], etag
            logger.error(
                "벡터 인덱스의 임베딩 모델(%s)이 현재 설정(%s)과 달라 사용하지 않습니다 — scripts.ingest를 다시 실행하세요",
                data.get("embedding_model"),
                self.embedding_model,
            )
            return
        items = data.get("items", [])
        if any(len(item["vector"]) != data.get("dimension") for item in items):
            self._items, self._etag = [], etag
            logger.error("벡터 인덱스의 차원이 dimension(%s)과 맞지 않아 사용하지 않습니다", data.get("dimension"))
            return
        self._items, self._etag = items, etag
        logger.info("벡터 인덱스 로드: %d건 (%s/%s)", len(items), self.bucket, self.key)

    def query(self, vector: list[float], top_k: int, hotels: list[str] | None = None) -> list[SearchHit]:
        with self._lock:
            self._refresh()
            items = self._items
        if items and len(vector) != len(items[0]["vector"]):
            logger.error("질문 벡터 차원(%d)이 인덱스와 달라 검색하지 않습니다", len(vector))
            return []
        if hotels:
            allowed = set(_hotel_values(hotels))
            items = [item for item in items if item["metadata"].get("hotel") in allowed]
        hits = [SearchHit(item["key"], item["text"], _cosine(vector, item["vector"])) for item in items]
        return sorted(hits, key=lambda hit: hit.score, reverse=True)[:top_k]

    def replace_all(self, items: list[VectorItem]) -> None:
        # 파일 전체를 새로 쓰므로 corpus에서 사라진 문서는 저절로 빠집니다.
        dimension = len(items[0]["vector"]) if items else 0
        body = {
            "embedding_model": self.embedding_model,
            "dimension": dimension,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "items": items,
        }
        self._s3().put_object(
            Bucket=self.bucket,
            Key=self.key,
            Body=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            ContentType="application/json",
        )
        with self._lock:
            self._checked_at = None  # 다음 query에서 바로 다시 읽음


class NoVectorStore:
    def is_configured(self) -> bool:
        return False

    def query(self, vector: list[float], top_k: int, hotels: list[str] | None = None) -> list[SearchHit]:
        return []

    def replace_all(self, items: list[VectorItem]) -> None:
        raise RuntimeError("VECTOR_STORE=none 이라 적재할 저장소가 없습니다")


def create_store() -> VectorStore:
    if config.VECTOR_STORE == "s3vectors":
        return S3VectorsStore(config.VECTOR_BUCKET_NAME, config.VECTOR_INDEX_NAME)
    if config.VECTOR_STORE == "object":
        return ObjectJsonStore(
            config.VECTOR_OBJECT_BUCKET,
            config.VECTOR_OBJECT_KEY,
            embedding_model=llm.embedding_model_name(),
            refresh_seconds=config.VECTOR_OBJECT_REFRESH_SECONDS,
        )
    if config.VECTOR_STORE == "none":
        return NoVectorStore()
    raise ValueError(f"VECTOR_STORE must be s3vectors, object or none, got {config.VECTOR_STORE!r}")
