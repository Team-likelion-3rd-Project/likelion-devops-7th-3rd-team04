# 도메인/인증서 관련 output 은 아직 만들지 않았으면 null 이다. 사용하는 스택은 null 일 때 HTTPS/레코드를 건너뛴다.
output "domain_name" {
  description = "서비스 루트 도메인 (도메인 구매 전 null)"
  value       = var.domain_name
}

output "zone_id" {
  description = "서브도메인 레코드를 만들 Hosted Zone ID (도메인 구매 전 null)"
  value       = one(aws_route53_zone.main[*].zone_id)
}

output "name_servers" {
  description = "도메인 등록 계정에서 이름 서버로 설정할 NS 4개 (도메인 구매 전 null)"
  value       = one(aws_route53_zone.main[*].name_servers)
}

output "certificate_arn" {
  description = "검증 완료된 루트 + 와일드카드 ACM 인증서 ARN, ALB·CloudFront 에서 사용 (인증서 생성 전 null)"
  value       = one(aws_acm_certificate_validation.main[*].certificate_arn)
}

output "log_bucket_name" {
  description = "장기 로그 버킷 이름 (Flow Logs · ALB 로그 · Fluent Bit 대상)"
  value       = aws_s3_bucket.logs.id
}

output "log_bucket_arn" {
  description = "장기 로그 버킷 ARN (Flow Logs 대상, Fluent Bit IAM 정책에서 사용)"
  value       = aws_s3_bucket.logs.arn
}

output "oidc_issuer_url" {
  description = "kube-apiserver --service-account-issuer 값"
  value       = local.oidc_issuer_url
}

output "oidc_bucket_name" {
  description = "클러스터 구축 시 keys.json 을 업로드할 버킷"
  value       = aws_s3_bucket.oidc.id
}

# 계정 ID 가 로그에 찍히지 않도록 OIDC 공급자 ARN 은 output 하지 않는다.
# IRSA Role 신뢰 정책의 Federated principal 은 사용하는 스택에서 만든다:
#   arn:aws:iam::<data.aws_caller_identity 의 account_id>:oidc-provider/<oidc_issuer_url 에서 https:// 를 뗀 값>
