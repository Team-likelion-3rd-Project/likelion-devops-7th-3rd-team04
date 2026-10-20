# 비밀값은 write-only 라 output 할 수 없다. 계정 ID 가 로그에 찍히지 않도록 ARN 대신 이름만 둔다.
# 40-cicd 는 의존 관계 없이 같은 이름 규칙(<project>/<environment>/ci-runner-*)으로 정책 ARN 을 만든다

output "secret_names" {
  description = "Secret 이름 (ci_runner_tailscale, ci_runner_gitlab)"
  value       = { for k, s in aws_secretsmanager_secret.this : k => s.name }
}
