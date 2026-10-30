# 필수 운영 알람 (LDP-145, 매일 재생성). ALARM 은 10-global 알람 토픽 → AWS Chatbot → Slack #alerts 로 보낸다.
# 해소(OK)는 ok_actions 대신 10-global EventBridge 규칙(alarm_recovered)이 ALARM → OK 전환만 보낸다 — ok_actions 는
# 알람을 새로 만들 때의 "데이터 부족 → OK" 에도 실행되어 매일 재생성마다 OK 알림이 온다. 알람 이름은 var.project- 로 시작해야 한다
#
#   payment-result-dlq       결제 결과 DLQ 에 메시지 (43)                 booking-service 가 처리하지 못한 결제 결과
#   main-alb-5xx-rate        ALB 5xx 비율 (80)                            api-gateway · 백엔드 오류, 워커 전부 다운
#   main-alb-<클러스터>-unhealthy  Target Group unhealthy (80, kubeadm · eks)   워커 · Traefik 이상
#   ec2-cpu-surplus-charged  계정 EC2 CPU 초과 크레딧 과금 (Metrics Insights)  t3a unlimited 초과 사용 → 인스턴스 타입 검토
#   payment-nlb-unhealthy    결제 NLB(PrivateLink) Target unhealthy (60)   결제 서버 이상 (배포 중 Standby 는 unhealthy 가 아님)
#   payment-deploy-failed    결제 배포 실패 · 롤백 (60 deploy 로그 지표 필터)
#   payment-mock-deployed    운영에 PAYMENT_PROVIDER=MOCK 배포 (60 deploy 로그 지표 필터, 부하 테스트 때는 예상된 알림)
#   RDS · Valkey 알람         data-stores.tf (LDP-180)
#   결제 지표 AMP 알람        payment-metrics.tf (LDP-181)
#
# 대응 절차는 infra/terraform/README.md "알림" 절. 지표가 없을 때(트래픽 · 이벤트 없음)는 정상으로 본다.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name             = var.project
  alerts_topic     = "arn:${data.aws_partition.current.partition}:sns:${var.region}:${data.aws_caller_identity.current.account_id}:${var.alerts_topic_name}"
  alarm_actions    = [local.alerts_topic]
  deploy_namespace = "${var.project}/payment-deploy"

  # unhealthy 알람 설명의 확인 대상 (키 = 80 target_group_arn_suffixes 키)
  alb_target_checks = {
    kubeadm = "워커 노드 · Traefik(NodePort 30080) 확인"
    eks     = "Traefik 파드(8000) · TargetGroupBinding · 노드 확인"
  }
}

# ── 결제 결과 DLQ ──

resource "aws_cloudwatch_metric_alarm" "payment_result_dlq" {
  alarm_name        = "${local.name}-payment-result-dlq"
  alarm_description = "결제 결과 DLQ(${var.queue_names.payment_result_dlq})에 메시지가 있습니다. booking-service 가 처리하지 못한 결제 결과 — 메시지 확인 후 재처리"

  namespace   = "AWS/SQS"
  metric_name = "ApproximateNumberOfMessagesVisible"
  dimensions = {
    QueueName = var.queue_names.payment_result_dlq
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

# ── 메인 ALB ──

resource "aws_cloudwatch_metric_alarm" "main_alb_5xx_rate" {
  alarm_name        = "${local.name}-main-alb-5xx-rate"
  alarm_description = "ALB 5xx 비율이 ${var.alb_5xx_rate_threshold}% 를 넘었습니다 (1분 3번 중 2번, 요청 ${var.alb_5xx_min_requests}건 이상일 때). backend 파드 · Traefik 상태 확인"

  comparison_operator = "GreaterThanThreshold"
  threshold           = var.alb_5xx_rate_threshold
  evaluation_periods  = 3
  datapoints_to_alarm = 2
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    label       = "5xx 비율(%)"
    expression  = "IF(requests >= ${var.alb_5xx_min_requests}, 100 * (FILL(target5xx, 0) + FILL(elb5xx, 0)) / requests, 0)"
    return_data = true
  }

  metric_query {
    id = "requests"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "RequestCount"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
      stat        = "Sum"
      period      = 60
    }
  }

  metric_query {
    id = "target5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_Target_5XX_Count"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
      stat        = "Sum"
      period      = 60
    }
  }

  # 대상이 없거나 응답하지 않을 때(502 · 503 · 504)는 ALB 가 직접 5xx 를 낸다
  metric_query {
    id = "elb5xx"
    metric {
      namespace   = "AWS/ApplicationELB"
      metric_name = "HTTPCode_ELB_5XX_Count"
      dimensions  = { LoadBalancer = var.alb_arn_suffix }
      stat        = "Sum"
      period      = 60
    }
  }

  alarm_actions = local.alarm_actions
}

# Target Group 별 (kubeadm 워커 NodePort, eks Traefik 파드). 대상이 없는 TG(전환 전 eks)는 지표가 없어 울리지 않는다
resource "aws_cloudwatch_metric_alarm" "main_alb_unhealthy" {
  for_each = var.alb_target_group_arn_suffixes

  alarm_name        = "${local.name}-main-alb-${each.key}-unhealthy"
  alarm_description = "${each.key} Target Group 에 unhealthy 대상이 ${var.unhealthy_evaluation_minutes}분 이상 있습니다. ${local.alb_target_checks[each.key]}"

  namespace   = "AWS/ApplicationELB"
  metric_name = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = var.alb_arn_suffix
    TargetGroup  = each.value
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = var.unhealthy_evaluation_minutes
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

# ── EC2 CPU 크레딧 (클러스터 종류와 무관) ──
# 계정의 모든 EC2(메인 노드 · 결제 서버, 전부 t3a unlimited)의 CPUSurplusCreditsCharged 합계.
# ASG 이름(EKS MNG 는 생성 때 정해짐)에 의존하지 않도록 Metrics Insights 로 계정 전체를 합한다.
# 초과 크레딧은 인스턴스가 종료될 때도 과금되므로 매일 destroy 직전에 값이 생길 수 있다 (알람 스택이 먼저 지워지면 알림 없음).
# 노드 평균 CPU(m6a.large 손익분기 약 41%)는 gitops kube-prometheus-stack PrometheusRule 이 본다

resource "aws_cloudwatch_metric_alarm" "ec2_cpu_surplus_charged" {
  alarm_name        = "${local.name}-ec2-cpu-surplus-charged"
  alarm_description = "EC2 CPU 초과 크레딧이 과금되었습니다 (계정 합계, 5분 합 ${var.ec2_cpu_surplus_charged_threshold} 초과). 노드 평균 CPU 알람 · Grafana 노드 대시보드 확인, 계속되면 m6a 등 고정 성능 타입 검토"

  comparison_operator = "GreaterThanThreshold"
  threshold           = var.ec2_cpu_surplus_charged_threshold
  evaluation_periods  = 1
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "charged"
    label       = "CPUSurplusCreditsCharged (계정 합계)"
    expression  = "SELECT SUM(CPUSurplusCreditsCharged) FROM SCHEMA(\"AWS/EC2\", InstanceId)"
    period      = 300
    return_data = true
  }

  alarm_actions = local.alarm_actions
}

# ── 결제 NLB (PrivateLink) ──

resource "aws_cloudwatch_metric_alarm" "payment_nlb_unhealthy" {
  alarm_name        = "${local.name}-payment-nlb-unhealthy"
  alarm_description = "결제 NLB 에 unhealthy 결제 서버가 ${var.unhealthy_evaluation_minutes}분 이상 있습니다. ASG 가 교체하는 중일 수 있음 — 결제 서버 app · deploy 로그 확인"

  namespace   = "AWS/NetworkELB"
  metric_name = "UnHealthyHostCount"
  dimensions = {
    LoadBalancer = var.payment_nlb_arn_suffix
    TargetGroup  = var.payment_target_group_arn_suffix
  }
  statistic           = "Maximum"
  period              = 60
  evaluation_periods  = var.unhealthy_evaluation_minutes
  comparison_operator = "GreaterThanThreshold"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}

# ── 결제 배포 이벤트 (pull agent JSON 로그 → 지표 필터) ──
# 형식은 60-payment-app templates/payment-deploy.sh event(): {event, image_tag, provider, detail, instance, az, mode}
# 이벤트가 있을 때만 지표가 생긴다(드문 지표). 알람은 최근 몇 분의 평가 범위에서 남은 값을 쓰므로 그대로 두면
# 마지막 1 이 범위에 남아 ALARM 이 오래 유지된다 → FILL(m, 0) 으로 빈 분을 0 으로 채워 다음 평가에서 OK 로 돌아오게 한다

resource "aws_cloudwatch_log_metric_filter" "payment_deploy_failed" {
  name           = "${local.name}-payment-deploy-failed"
  log_group_name = var.payment_deploy_log_group_name
  # deploy_failed 뒤에 롤백(rollback_success · rollback_failed · rollback_skipped)이 이어지므로 롤백도 이 지표에 걸린다
  pattern = "{ ($.event = \"deploy_failed\") || ($.event = \"invalid_release\") || ($.event = \"rollback_failed\") }"

  metric_transformation {
    namespace = local.deploy_namespace
    name      = "DeployFailed"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "payment_deploy_failed" {
  alarm_name        = "${local.name}-payment-deploy-failed"
  alarm_description = "결제 서버 배포가 실패했습니다 (없는 이미지 태그 · release 형식 · Flyway · 헬스 실패 → 롤백). Slack #deploy 의 인스턴스별 결과와 deploy 로그 확인"

  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "events"
    label       = "DeployFailed (빈 분은 0)"
    expression  = "FILL(m, 0)"
    return_data = true
  }

  metric_query {
    id = "m"
    metric {
      namespace   = local.deploy_namespace
      metric_name = aws_cloudwatch_log_metric_filter.payment_deploy_failed.metric_transformation[0].name
      stat        = "Sum"
      period      = 60
    }
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_log_metric_filter" "payment_mock_deployed" {
  name           = "${local.name}-payment-mock-deployed"
  log_group_name = var.payment_deploy_log_group_name
  pattern        = "{ ($.event = \"deploy_success\") && ($.provider = \"MOCK\") }"

  metric_transformation {
    namespace = local.deploy_namespace
    name      = "MockProviderDeployed"
    value     = "1"
    unit      = "Count"
  }
}

resource "aws_cloudwatch_metric_alarm" "payment_mock_deployed" {
  alarm_name        = "${local.name}-payment-mock-deployed"
  alarm_description = "운영 결제 서버가 PAYMENT_PROVIDER=MOCK 으로 배포되었습니다 (실제 결제 안 됨). 부하 테스트가 아니면 gitops payment values 를 TOSS 로 되돌리는 PR"

  evaluation_periods  = 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "events"
    label       = "MockProviderDeployed (빈 분은 0)"
    expression  = "FILL(m, 0)"
    return_data = true
  }

  metric_query {
    id = "m"
    metric {
      namespace   = local.deploy_namespace
      metric_name = aws_cloudwatch_log_metric_filter.payment_mock_deployed.metric_transformation[0].name
      stat        = "Sum"
      period      = 60
    }
  }

  alarm_actions = local.alarm_actions
}
