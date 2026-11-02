# 웹훅 큐. 중복 방지는 inbox UNIQUE 키가 맡고 결제 건 사이 순서는 필요 없어 표준 큐를 쓴다.
# 큐 이름이 고정이라 재생성 후에도 큐 URL 이 같다. 큐 URL · ARN 에는 계정 ID 가 들어가므로 이름만 output 한다.

resource "aws_sqs_queue" "webhook_dlq" {
  name                    = var.webhook_dlq_name
  sqs_managed_sse_enabled = true

  # 최대값. 원본 큐 보관 기간이 지나도 DLQ 에서는 사라지지 않게 한다 (DLQ 로 옮겨도 보관 기간은 최초 전송 시각 기준)
  message_retention_seconds = 1209600 # 14일
}

resource "aws_sqs_queue" "webhook" {
  name                       = var.webhook_queue_name
  sqs_managed_sse_enabled    = true
  visibility_timeout_seconds = var.webhook_visibility_timeout

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.webhook_dlq.arn
    maxReceiveCount     = var.webhook_max_receive_count
  })
}

# DLQ 는 이 원본 큐의 메시지만 받는다
resource "aws_sqs_queue_redrive_allow_policy" "webhook_dlq" {
  queue_url = aws_sqs_queue.webhook_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.webhook.arn]
  })
}

# 큐 정책 (43-messaging 과 같은 방식). 권한 부여는 각 주체의 IAM 정책이 하고, 큐 정책은 Deny 로 범위를 좁힌다.
#
#   웹훅 큐  send             Lambda Role, 관리자(토스 테스트 웹훅으로 재현할 수 없는 DLQ 이동 검증)
#            receive · delete 결제 앱 Role 만 (관리자가 가져가면 웹훅이 누락되므로 관리자도 막는다)
#   DLQ      send · receive · delete 관리자만 (메인 큐에서 옮겨지는 것은 SQS 가 처리)
#   공통     TLS 가 아닌 요청 거부
#
# 결제 앱 Role 은 Principal 이 아니라 aws:PrincipalArn 조건으로 참조한다. Role 이 아직 없어도(60 apply 전) 정책을 만들 수 있다.
# 관리자 ARN 은 레포에 적지 않고 apply 실행 주체에서 읽는다.
locals {
  consume_actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"]

  # 큐 → { 허용 주체 } . 목록에 없는 주체의 해당 동작은 거부
  queue_access = {
    webhook = {
      queue   = aws_sqs_queue.webhook
      send    = [local.lambda_role_arn, local.admin_arn]
      consume = [local.payment_app_arn]
    }
    webhook_dlq = {
      queue   = aws_sqs_queue.webhook_dlq
      send    = [local.admin_arn]
      consume = [local.admin_arn]
    }
  }
}

data "aws_iam_policy_document" "queue" {
  for_each = local.queue_access

  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["sqs:*"]
    resources = [each.value.queue.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }

  statement {
    sid       = "DenySendExceptAllowedPrincipals"
    effect    = "Deny"
    actions   = ["sqs:SendMessage"]
    resources = [each.value.queue.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values   = each.value.send
    }
  }

  statement {
    sid       = "DenyConsumeExceptAllowedPrincipals"
    effect    = "Deny"
    actions   = local.consume_actions
    resources = [each.value.queue.arn]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values   = each.value.consume
    }
  }
}

resource "aws_sqs_queue_policy" "this" {
  for_each = local.queue_access

  queue_url = each.value.queue.id
  policy    = data.aws_iam_policy_document.queue[each.key].json
}
