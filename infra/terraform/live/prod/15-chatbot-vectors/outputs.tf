# 계정 ID 가 로그에 찍히지 않도록 ARN 은 output 하지 않는다. IAM 정책은 이름으로 ARN 을 만든다:
#   arn:aws:s3vectors:<리전>:<계정>:bucket/<버킷>/index/<인덱스>

output "vector_bucket_name" {
  description = "RAG 벡터 버킷 (llm-service VECTOR_BUCKET_NAME)"
  value       = aws_s3vectors_vector_bucket.main.vector_bucket_name
}

output "vector_index_name" {
  description = "RAG 벡터 인덱스 (llm-service VECTOR_INDEX_NAME)"
  value       = aws_s3vectors_index.docs.index_name
}
