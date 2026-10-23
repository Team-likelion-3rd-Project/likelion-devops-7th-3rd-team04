# 계정 ID 가 로그에 찍히지 않도록 KeyValueStore · 배포 ARN 은 output 하지 않는다.
# gitops Secret FRONTEND_KVS_ARN 은 아래 이름으로 조회한다:
#   aws cloudfront describe-key-value-store --name <kvs_name> --query KeyValueStore.ARN --output text

output "site_url" {
  description = "프론트 주소"
  value       = "https://${var.domain_name}"
}

output "site_bucket_name" {
  description = "프론트 빌드 버킷 (release:frontend 가 releases/<main SHA>/ 에 업로드)"
  value       = aws_s3_bucket.this["site"].id
}

output "image_bucket_name" {
  description = "객실 사진 버킷 (hotel-service S3_BUCKET)"
  value       = aws_s3_bucket.this["image"].id
}

output "image_base_url" {
  description = "hotel-service IMAGE_BASE_URL — 사진 고정 URL 은 <이 값>/<objectKey>"
  value       = "https://${var.domain_name}"
}

output "kvs_name" {
  description = "현재 사이트 버전(version 키)을 둔 CloudFront KeyValueStore 이름"
  value       = aws_cloudfront_key_value_store.main.name
}

output "distribution_id" {
  description = "CloudFront 배포 ID (무효화 · 확인용, 버전 전환에는 필요 없음)"
  value       = aws_cloudfront_distribution.main.id
}
