# 관측 기반 (매일 재생성). 알람은 맨 뒤 90-observability-alarms 가 만든다.
#
# 메인 클러스터 로그 그룹 — Fluent Bit(gitops fluent-bit, DaemonSet) 이 네임스페이스별로 보낸다.
#   /team04-hotel/prod/cluster/<네임스페이스>   cluster_log_namespaces
#   /team04-hotel/prod/cluster/other            목록에 없는 네임스페이스
#
# Fluent Bit 은 그룹을 만들지 않는다(auto_create_group off, IRSA Role 에 CreateLogGroup 없음).
# 그룹은 매일 destroy 로 지워지고, 같은 로그가 10-global 로그 버킷 app-logs/main-cluster/ 에 날짜별로 남는다.

locals {
  cluster_log_group_prefix = "/${var.project}/${var.environment}/cluster"
  cluster_log_namespaces   = toset(concat(var.cluster_log_namespaces, ["other"]))
}

resource "aws_cloudwatch_log_group" "cluster" {
  for_each = local.cluster_log_namespaces

  name              = "${local.cluster_log_group_prefix}/${each.key}"
  retention_in_days = var.cluster_log_retention_days
}
