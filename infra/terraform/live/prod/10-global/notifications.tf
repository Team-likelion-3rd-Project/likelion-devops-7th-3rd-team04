# 운영 알림 (LDP-145). SNS 토픽 → AWS Chatbot(Amazon Q Developer in chat applications) → Slack.
#
#   team04-hotel-alerts  ← CloudWatch 알람 ALARM (90-observability-alarms alarm_actions)    → #alerts
#                          EventBridge 규칙: 알람 ALARM → OK 전환만 (아래 alarm_recovered)
#                          메인 클러스터 Alertmanager (51 IRSA alertmanager, gitops kube-prometheus-stack)
#                          결제 지표 AMP Alertmanager (metrics.tf, 서비스 주체 aps)
#   team04-hotel-deploy  ← 메인 클러스터 ArgoCD 알림 hook (51 IRSA deploy-notify)          → #deploy
#                          결제 서버 pull agent (60 Instance Role, 44 sns 엔드포인트)
#                          gitops sync-frontend-version workflow (gitops_ssm_sync Role)
#
# 토픽 · 키 · Chatbot 은 🔒 상시 유지라 매일 재생성 후에도 Slack 재연결 · 구독 확인이 없다 (Chatbot 이 HTTPS 구독을 직접 관리).
# 발행 주체 Role 은 🔁 스택이 매일 다시 만들므로 토픽 정책은 Role ARN principal 이 아니라 aws:PrincipalArn 조건으로 막는다
# (principal 에 없는 Role ARN 을 넣으면 정책이 거부되고, 다시 만든 Role 은 다른 내부 ID 를 갖는다).
# 발행 주체의 Publish · KMS 권한은 각자 스택의 Role 정책에 둔다. 토픽 정책은 그 밖의 주체를 거부한다.
#
# Slack 워크스페이스 · 채널 ID 는 레포에 두지 않는다 (terraform.tfvars, gitignore).

locals {
  alerts_topic_name = "${var.project}-alerts"
  deploy_topic_name = "${var.project}-deploy"

  # 배포 토픽 발행 주체 (고정 이름, 51-pod-roles · 60 iam.tf · 이 스택 github-oidc.tf)
  deploy_publisher_role_arns = [
    for name in concat(var.deploy_publisher_role_names, [aws_iam_role.gitops_ssm_sync.name]) :
    "arn:${data.aws_partition.current.partition}:iam::${local.account_id}:role/${name}"
  ]

  # 알림 토픽에 발행하는 Role (서비스 주체 CloudWatch · EventBridge 외, 고정 이름 51-pod-roles)
  alert_publisher_role_arns = [
    for name in var.alert_publisher_role_names :
    "arn:${data.aws_partition.current.partition}:iam::${local.account_id}:role/${name}"
  ]
}

# ── 저장 암호화 키 ──
# AWS 관리형 키(alias/aws/sns)는 키 정책을 바꿀 수 없어 CloudWatch 알람이 발행하지 못한다 → 고객 관리형 키
data "aws_iam_policy_document" "notifications_kms" {
  # 계정 IAM 정책으로 키 권한을 준다 (발행 주체 Role 정책의 kms:GenerateDataKey · Decrypt)
  statement {
    sid       = "AccountIamPolicies"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${data.aws_partition.current.partition}:iam::${local.account_id}:root"]
    }
  }

  # CloudWatch 알람(ALARM) · EventBridge 규칙(ALARM → OK) · AMP Alertmanager(metrics.tf)가 암호화된 토픽에 발행
  statement {
    sid       = "AlarmPublishers"
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt"]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com", "events.amazonaws.com", "aps.amazonaws.com"]
    }
  }
}

resource "aws_kms_key" "notifications" {
  description         = "SNS notification topics (alerts, deploy)"
  enable_key_rotation = true
  policy              = data.aws_iam_policy_document.notifications_kms.json

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_kms_alias" "notifications" {
  name          = "alias/${var.project}-notifications"
  target_key_id = aws_kms_key.notifications.key_id
}

# ── 토픽 ──

resource "aws_sns_topic" "alerts" {
  name              = local.alerts_topic_name
  kms_master_key_id = aws_kms_key.notifications.arn

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_sns_topic" "deploy" {
  name              = local.deploy_topic_name
  kms_master_key_id = aws_kms_key.notifications.arn

  lifecycle {
    prevent_destroy = true
  }
}

# 알람 토픽: 이 계정의 CloudWatch 알람과 아래 EventBridge 규칙만 발행
data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid       = "CloudWatchAlarmsPublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:cloudwatch:${var.region}:${local.account_id}:alarm:*"]
    }
  }

  statement {
    sid       = "AlarmRecoveredRulePublish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["events.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudwatch_event_rule.alarm_recovered.arn]
    }
  }

  # 결제 지표 AMP 워크스페이스의 Alertmanager (metrics.tf). GetTopicAttributes 는 AMP 가 발행 전에 토픽을 확인할 때 쓴다
  statement {
    sid       = "PaymentMetricsAlertmanagerPublish"
    actions   = ["sns:Publish", "sns:GetTopicAttributes"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "Service"
      identifiers = ["aps.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [aws_prometheus_workspace.payment.arn]
    }
  }

  # 같은 계정 IAM 주체(관리자 포함)의 직접 발행을 막는다. 서비스 주체 요청에는 aws:PrincipalServiceName 이 있다.
  # 두 조건은 AND — 서비스 주체도 아니고 발행 Role(alert_publisher_role_names)도 아니면 거부.
  # 서비스 주체 요청에는 aws:PrincipalArn 이 없어 두 번째 조건이 참이지만 첫 번째가 거짓이라 통과한다.
  # Role 의 Publish · KMS 허용은 Role 정책(51-pod-roles)에 있다 (deploy 토픽과 같은 방식)
  statement {
    sid       = "DenyOtherPublishers"
    effect    = "Deny"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalServiceName"
      values   = ["cloudwatch.amazonaws.com", "events.amazonaws.com", "aps.amazonaws.com"]
    }

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = local.alert_publisher_role_arns
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

# 해소(OK) 알림. 알람의 ok_actions 는 이전 상태와 상관없이 OK 가 되면 실행되어, 매일 재생성으로 알람을 새로 만들 때마다
# "데이터 부족 → OK" 알림이 온다. 그래서 90 알람에는 ok_actions 를 두지 않고 여기서 ALARM → OK 전환만 보낸다.
# 알람 이름 접두사로 고르므로 🔁 90 이 알람을 매일 다시 만들어도 이 규칙은 그대로다
resource "aws_cloudwatch_event_rule" "alarm_recovered" {
  name        = "${var.project}-alarm-recovered"
  description = "CloudWatch alarm ALARM -> OK (${var.project}-*) to alerts topic"

  event_pattern = jsonencode({
    source      = ["aws.cloudwatch"]
    detail-type = ["CloudWatch Alarm State Change"]
    detail = {
      alarmName     = [{ prefix = "${var.project}-" }]
      state         = { value = ["OK"] }
      previousState = { value = ["ALARM"] }
    }
  })
}

# Chatbot 은 "CloudWatch Alarm State Change" 이벤트 원본을 지원하지 않는다 (로그: Event received is not supported).
# 사용자 정의 알림 형식(#deploy 와 같은 형식)으로 바꿔 보낸다. jsonencode 는 < > 를 \u003c 로 바꿔 자리표시가 깨지므로 직접 쓴다
resource "aws_cloudwatch_event_target" "alarm_recovered" {
  rule = aws_cloudwatch_event_rule.alarm_recovered.name
  arn  = aws_sns_topic.alerts.arn

  input_transformer {
    input_paths = {
      alarm       = "$.detail.alarmName"
      reason      = "$.detail.state.reason"
      description = "$.detail.configuration.description"
      time        = "$.time"
    }
    input_template = <<-EOT
      {
        "version": "1.0",
        "source": "custom",
        "content": {
          "textType": "client-markdown",
          "title": ":white_check_mark: CloudWatch Alarm 해소 | <alarm>",
          "description": "*상태* ALARM → OK (<time>)\n*사유* <reason>\n*알람 설명* <description>"
        },
        "metadata": {
          "summary": "CloudWatch Alarm 해소 | <alarm>",
          "eventType": "alarm_recovered",
          "additionalContext": { "alarm": "<alarm>" }
        }
      }
    EOT
  }
}

# 배포 토픽: 발행 주체 Role 만 발행 (Allow 는 각 Role 의 IAM 정책, 여기서는 나머지 거부)
data "aws_iam_policy_document" "deploy_topic" {
  statement {
    sid       = "DenyOtherPublishers"
    effect    = "Deny"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.deploy.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "ArnNotEquals"
      variable = "aws:PrincipalArn"
      values   = local.deploy_publisher_role_arns
    }
  }
}

resource "aws_sns_topic_policy" "deploy" {
  arn    = aws_sns_topic.deploy.arn
  policy = data.aws_iam_policy_document.deploy_topic.json
}

# ── AWS Chatbot → Slack ──
# Chatbot API 는 us-east-1 엔드포인트가 없어 별도 리전 provider 로 만든다 (다른 리전 토픽도 구독할 수 있다).
# Slack 워크스페이스 연결(OAuth)은 콘솔에서 1회 — 이미 완료. 비공개 채널이면 채널에 /invite @Amazon Q 가 필요하다
provider "aws" {
  alias  = "chatbot"
  region = var.chatbot_region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      Stack       = "global"
      ManagedBy   = "terraform"
    }
  }
}

data "aws_iam_policy_document" "chatbot_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["chatbot.amazonaws.com"]
    }
  }
}

# 알림 수신만. Role 에 정책을 붙이지 않고 채널 guardrail 도 AWSDenyAll 이라 Slack 에서 AWS 명령을 실행할 수 없다
resource "aws_iam_role" "chatbot" {
  name               = "${var.project}-chatbot"
  description        = "AWS Chatbot Slack channels (notifications only, no permissions)"
  assume_role_policy = data.aws_iam_policy_document.chatbot_assume.json
}

locals {
  chatbot_channels = {
    alerts = { channel_id = var.slack_alerts_channel_id, topic_arn = aws_sns_topic.alerts.arn }
    deploy = { channel_id = var.slack_deploy_channel_id, topic_arn = aws_sns_topic.deploy.arn }
  }
}

resource "aws_chatbot_slack_channel_configuration" "main" {
  for_each = local.chatbot_channels
  provider = aws.chatbot

  configuration_name    = "${var.project}-${each.key}"
  iam_role_arn          = aws_iam_role.chatbot.arn
  slack_team_id         = var.slack_team_id
  slack_channel_id      = each.value.channel_id
  sns_topic_arns        = [each.value.topic_arn]
  guardrail_policy_arns = ["arn:${data.aws_partition.current.partition}:iam::aws:policy/AWSDenyAll"]
  logging_level         = "ERROR"

  user_authorization_required = false
}

# gitops sync-frontend-version workflow 의 배포 결과 발행 (같은 Role 의 결제 release · KeyValueStore 권한과 분리)
data "aws_iam_policy_document" "gitops_deploy_notify" {
  statement {
    sid       = "PublishDeployResult"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.deploy.arn]
  }

  statement {
    sid       = "EncryptDeployResult"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = [aws_kms_key.notifications.arn]
  }
}

resource "aws_iam_role_policy" "gitops_deploy_notify" {
  name   = "deploy-notify"
  role   = aws_iam_role.gitops_ssm_sync.id
  policy = data.aws_iam_policy_document.gitops_deploy_notify.json
}
