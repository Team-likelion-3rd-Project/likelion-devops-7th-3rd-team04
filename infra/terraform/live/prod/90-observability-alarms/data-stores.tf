# DB · 캐시 알람 (LDP-180). main.tf 와 같은 알림 경로(알람 토픽 → Slack #alerts, 해소는 10-global EventBridge).
#
#   <db>-db-cpu-surplus     RDS CPUSurplusCreditBalance (41 메인 · 42 결제)   기준 성능을 넘겨 크레딧을 빚지는 중 (t4g Unlimited, 추가 요금)
#   <db>-db-low-memory      RDS FreeableMemory                                메모리 부족 → 스왑 · 느려짐
#   <db>-db-low-storage     RDS FreeStorageSpace                              디스크 부족 → 쓰기 실패
#   <db>-db-connections     RDS DatabaseConnections                           max_connections 에 가까움 → 새 접속 거부
#   valkey-<노드>-memory      Valkey DatabaseMemoryUsagePercentage (41)       maxmemory 에 가까움 → 축출 시작
#   valkey-<노드>-evictions   Valkey Evictions                                 키 축출 (리프레시 토큰이 사라져 재로그인)
#   valkey-<노드>-connections Valkey CurrConnections                           연결 누수
#
# CPUCreditBalance(잔액 낮음)는 쓰지 않는다 — RDS t4g 는 생성 직후 잔액 0 에서 시간당 약 6 씩 쌓여(10-29 실측)
# 매일 재생성 후 몇 시간 동안 알람이 계속 울린다. Unlimited 모드라 잔액이 0 이어도 느려지지 않고 Surplus(빚)가 쌓인다.
# Valkey 알람 이름의 <노드>는 노드 ID 에서 프로젝트 접두사를 뺀 것 (team04-hotel-valkey-main-001-memory).
# 기준값 근거(10-29 실측, db.t4g.micro): max_connections 30(LEAST({DBInstanceClassMemory/25165760},12000)), 메인 사용 22
# (앱 20 + rdsadmin 2), FreeableMemory 110 – 140 MiB 에서 천천히 감소, Valkey 메모리 1.7% · 연결 6.

# ── RDS (메인 · 결제) ──

resource "aws_cloudwatch_metric_alarm" "db_cpu_surplus" {
  for_each = var.db_instance_identifiers

  alarm_name        = "${local.name}-${each.key}-db-cpu-surplus"
  alarm_description = "${each.value} 가 CPU 기준 성능을 넘겨 빚진 크레딧(CPUSurplusCreditBalance)이 ${var.db_cpu_surplus_threshold} 이상입니다 (5분 3번). 느린 쿼리(slowquery 로그) · 접속 수 확인, 계속되면 인스턴스 클래스 상향"

  namespace   = "AWS/RDS"
  metric_name = "CPUSurplusCreditBalance"
  dimensions = {
    DBInstanceIdentifier = each.value
  }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.db_cpu_surplus_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "db_low_memory" {
  for_each = var.db_instance_identifiers

  alarm_name        = "${local.name}-${each.key}-db-low-memory"
  alarm_description = "${each.value} 여유 메모리(FreeableMemory)가 ${var.db_freeable_memory_mib} MiB 미만입니다 (5분 3번). 접속 수 · 슬로우 쿼리 확인, 계속되면 인스턴스 클래스 상향"

  namespace   = "AWS/RDS"
  metric_name = "FreeableMemory"
  dimensions = {
    DBInstanceIdentifier = each.value
  }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = var.db_freeable_memory_mib * 1024 * 1024
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "db_low_storage" {
  for_each = var.db_instance_identifiers

  alarm_name        = "${local.name}-${each.key}-db-low-storage"
  alarm_description = "${each.value} 여유 디스크(FreeStorageSpace)가 ${var.db_free_storage_gib} GiB 미만입니다. 테이블 · 로그 크기 확인, allocated_storage 상향"

  namespace   = "AWS/RDS"
  metric_name = "FreeStorageSpace"
  dimensions = {
    DBInstanceIdentifier = each.value
  }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = var.db_free_storage_gib * 1024 * 1024 * 1024
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "db_connections" {
  for_each = var.db_instance_identifiers

  alarm_name        = "${local.name}-${each.key}-db-connections"
  alarm_description = "${each.value} 접속 수(DatabaseConnections)가 ${var.db_connections_threshold} 이상입니다 (1분 5번 중 3번, max_connections 30). 앱 커넥션 풀 크기 · 파드 수 확인 — 넘으면 새 접속이 거부됩니다"

  namespace   = "AWS/RDS"
  metric_name = "DatabaseConnections"
  dimensions = {
    DBInstanceIdentifier = each.value
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 5
  datapoints_to_alarm = 3
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = var.db_connections_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

# ── Valkey (노드별 지표, CacheClusterId) ──

resource "aws_cloudwatch_metric_alarm" "valkey_memory" {
  for_each = toset(var.valkey_member_clusters)

  alarm_name        = "${local.name}-valkey-${trimprefix(each.key, "${var.project}-")}-memory"
  alarm_description = "Valkey ${each.key} 메모리 사용률이 ${var.valkey_memory_percent_threshold}% 를 넘었습니다 (5분 3번). 키 수 · TTL 확인, 넘치면 축출이 시작됩니다"

  namespace   = "AWS/ElastiCache"
  metric_name = "DatabaseMemoryUsagePercentage"
  dimensions = {
    CacheClusterId = each.key
  }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.valkey_memory_percent_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "valkey_evictions" {
  for_each = toset(var.valkey_member_clusters)

  alarm_name        = "${local.name}-valkey-${trimprefix(each.key, "${var.project}-")}-evictions"
  alarm_description = "Valkey ${each.key} 에서 키가 축출(Evictions)되었습니다. 리프레시 토큰이 사라져 사용자가 다시 로그인해야 할 수 있음 — 메모리 사용률 확인, 노드 타입 상향"

  namespace   = "AWS/ElastiCache"
  metric_name = "Evictions"
  dimensions = {
    CacheClusterId = each.key
  }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "valkey_connections" {
  for_each = toset(var.valkey_member_clusters)

  alarm_name        = "${local.name}-valkey-${trimprefix(each.key, "${var.project}-")}-connections"
  alarm_description = "Valkey ${each.key} 연결 수(CurrConnections)가 ${var.valkey_connections_threshold} 를 넘었습니다 (5분 3번, 평소 10 미만). auth-service 연결 누수 · 파드 수 확인"

  namespace   = "AWS/ElastiCache"
  metric_name = "CurrConnections"
  dimensions = {
    CacheClusterId = each.key
  }
  statistic           = "Maximum"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = var.valkey_connections_threshold
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}
