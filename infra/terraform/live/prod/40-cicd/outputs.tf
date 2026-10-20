# 계정 ID 가 로그에 찍히지 않도록 ARN 대신 이름만 둔다

output "runner_role_name" {
  description = "Runner IAM Role 이름 (12-secrets ci_runner_role_name 과 같아야 함)"
  value       = aws_iam_role.runner.name
}

output "runner_asg_name" {
  description = "Runner ASG 이름 (인스턴스 확인 · 교체)"
  value       = aws_autoscaling_group.runner.name
}
