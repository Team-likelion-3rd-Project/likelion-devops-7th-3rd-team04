output "state_bucket_name" {
  description = "다른 스택의 backend 설정에 사용할 버킷 이름"
  value       = aws_s3_bucket.tfstate.id
}

output "state_bucket_region" {
  description = "state 버킷 리전"
  value       = var.region
}
