# 비밀값은 write-only 라 output 할 수 없다. 계정 ID 가 로그에 찍히지 않도록 ARN 대신 이름만 둔다.
# 60-payment-app · 70-main-cluster-kubeadm 은 의존 관계 없이 같은 이름 규칙(<project>/<environment>/<이름>)으로 정책 ARN 을 만든다

output "toss_client_key_parameter_name" {
  description = "토스 클라이언트 키 Parameter Store 이름 (release:frontend-build 가 읽음)"
  value       = aws_ssm_parameter.toss_client_key.name
}

output "secret_names" {
  description = "Secret 이름 (github_app, toss_payments, seed_admin, grafana_admin)"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}
