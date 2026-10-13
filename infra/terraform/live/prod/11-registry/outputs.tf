output "repository_urls" {
  description = "서비스 이름 → ECR 리포지토리 URL"
  value       = { for k, r in aws_ecr_repository.service : k => r.repository_url }
}

output "repository_arns" {
  description = "서비스 이름 → ECR 리포지토리 ARN (CI push 권한 정책에서 사용)"
  value       = { for k, r in aws_ecr_repository.service : k => r.arn }
}

output "image_tag_parameter_names" {
  description = "서비스 이름 → 이미지 태그 Parameter Store 이름"
  value       = { for k, p in aws_ssm_parameter.image_tag : k => p.name }
}
