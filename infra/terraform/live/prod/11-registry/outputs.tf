output "repository_urls" {
  description = "서비스 이름 → ECR 리포지토리 URL"
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

# 계정 ID 가 로그에 찍히지 않도록 리포지토리 ARN 은 output 하지 않는다.
# CI push 권한 정책은 사용하는 스택에서 data.aws_ecr_repository 또는 정확한 계정 ID 로 ARN 을 만든다.

output "payment_release_parameter_name" {
  description = "결제 서버 release {image_tag, env} Parameter Store 이름 (gitops sync-payment-tag workflow 가 쓴다)"
  value       = aws_ssm_parameter.payment_release.name
}

output "image_tag_parameter_names" {
  description = "서비스 이름 → 이미지 태그 Parameter Store 이름"
  value       = { for k, p in aws_ssm_parameter.image_tag : k => p.name }
}
