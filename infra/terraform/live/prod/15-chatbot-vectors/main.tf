# 챗봇 RAG 벡터 저장소 (S3 Vectors, 🔒 상시 유지).
#
#   llm-ingest Job (릴리스마다)  app/corpus.py 문서 임베딩 → PutVectors (문서 id 가 key 라 다시 넣어도 중복 없음)
#   llm-service                  질문 임베딩 → QueryVectors (원문은 metadata.text)
#
# 권한은 이 버킷의 정책이 아니라 70 IRSA Role(llm-service 조회 · llm-ingest 쓰기)에 둔다.
# 인덱스 설정(차원 · 거리 · metadata 설정)은 만든 뒤 바꿀 수 없다 — 바꾸면 교체되므로 prevent_destroy 로 막고 이름을 바꿔 새로 만든다.

resource "aws_s3vectors_vector_bucket" "main" {
  vector_bucket_name = var.vector_bucket_name

  encryption_configuration {
    sse_type = "AES256"
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3vectors_index" "docs" {
  vector_bucket_name = aws_s3vectors_vector_bucket.main.vector_bucket_name
  index_name         = var.vector_index_name

  data_type       = "float32"
  dimension       = var.vector_dimension
  distance_metric = "cosine"

  # 원문(text)은 검색 결과로 돌려주기만 하고 필터에는 쓰지 않는다. 필터 가능 metadata 는 벡터당 2KB 제한이 있어 빼 둔다
  metadata_configuration {
    non_filterable_metadata_keys = ["text"]
  }

  lifecycle {
    prevent_destroy = true
  }
}
