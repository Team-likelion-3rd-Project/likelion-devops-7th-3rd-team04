# 결제 지표 AMP 알람 (LDP-181). main.tf 와 같은 알림 경로(알람 토픽 → Slack #alerts, 해소는 10-global EventBridge).
#
#   payment-metrics-discarded       AMP 가 결제 서버 샘플을 버림 (AWS/Prometheus DiscardedSamples, 모든 Reason 합)
#                                   주로 1시간 넘게 WAL 에 쌓였던 샘플(greater_than_max_sample_age) — 엔드포인트 · 권한이 막혔다가 풀린 경우
#   payment-metrics-notify-failed   AMP Alertmanager 가 알림 토픽에 발행하지 못함 (토픽 · KMS 정책, 메시지 템플릿)
#                                   AMP 알림 자체가 Slack 에 닿지 않으므로 CloudWatch 알람으로 따로 알린다
#
# 워크스페이스는 🔒 10-global 이라 매일 재생성과 무관하게 같은 ID 다. 지표가 없을 때(정상)는 데이터 부족 → notBreaching.
# Reason 차원마다 지표가 따로 생겨 Metrics Insights 로 합친다

resource "aws_cloudwatch_metric_alarm" "payment_metrics_discarded" {
  alarm_name        = "${local.name}-payment-metrics-discarded"
  alarm_description = "AMP 워크스페이스(${var.payment_metrics_workspace_id})가 결제 지표 샘플을 버렸습니다 (5분). Reason 차원 확인 — greater_than_max_sample_age 면 결제 서버 Alloy 가 1시간 넘게 보내지 못했던 것 (44 aps-workspaces 엔드포인트 · aps:RemoteWrite · Alloy 로그 /payment/app <인스턴스>/alloy)"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "discarded"
    label       = "DiscardedSamples (all reasons)"
    expression  = "SELECT SUM(DiscardedSamples) FROM \"AWS/Prometheus\" WHERE Workspace = '${var.payment_metrics_workspace_id}'"
    period      = 300
    return_data = true
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "payment_metrics_notify_failed" {
  alarm_name        = "${local.name}-payment-metrics-notify-failed"
  alarm_description = "AMP Alertmanager 가 알림 토픽 발행에 실패했습니다 (5분). 결제 지표 알림이 Slack 에 오지 않음 — 10-global 토픽 정책(aps) · KMS 키 정책 · metrics.tf 메시지 템플릿 확인"

  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "failed"
    label       = "AlertManagerNotificationsFailed"
    expression  = "SELECT SUM(AlertManagerNotificationsFailed) FROM \"AWS/Prometheus\" WHERE Workspace = '${var.payment_metrics_workspace_id}'"
    period      = 300
    return_data = true
  }

  alarm_actions = local.alarm_actions
}
