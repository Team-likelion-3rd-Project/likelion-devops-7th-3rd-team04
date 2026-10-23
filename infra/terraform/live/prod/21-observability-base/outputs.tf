# 계정 ID 가 로그에 찍히지 않도록 로그 그룹 ARN 은 output 하지 않는다. 사용하는 쪽이 이름으로 만든다
#   arn:aws:logs:<리전>:<계정>:log-group:<이름>

output "cluster_log_group_names" {
  description = "메인 클러스터 로그 그룹 이름 (네임스페이스 → 그룹, other 포함). 70 Fluent Bit IRSA Role 이 이 그룹에만 쓴다"
  value       = { for ns, group in aws_cloudwatch_log_group.cluster : ns => group.name }
}
