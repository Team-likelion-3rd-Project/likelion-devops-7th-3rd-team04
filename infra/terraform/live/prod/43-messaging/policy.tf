# 큐 정책. 같은 계정이라 권한 부여는 각 주체의 IAM 정책(70 irsa.tf · 60) 이 하고, 큐 정책은 Deny 로 범위를 좁힌다.
# IAM 정책으로 sqs:* 를 받은 다른 주체(공유 계정)도 큐 정책의 Deny 가 우선한다.
#
#   메인 큐  send            결제 앱 Role, 관리자(수동 재발행 · 60 구축 전 검증)
#            receive · delete booking Role 만 (관리자가 가져가면 예약 확정이 누락되므로 관리자도 막는다)
#   DLQ      receive · delete 관리자만 (장애 메시지 확인 · 재처리)
#            send            관리자만 (메인 큐에서 옮겨지는 것은 SQS 가 처리)
#   공통     TLS 가 아닌 요청 거부
#
# Role 은 Principal 이 아니라 aws:PrincipalArn 조건으로 참조한다. Role 이 아직 없어도(60 · 70 apply 전) 정책을 만들 수 있다.
# 관리자 ARN 은 레포에 적지 않고 apply 실행 주체에서 읽는다 (41-main-data 와 같음, assume role 이면 Role ARN)

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  role_arn_prefix = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role"
  admin_arn       = data.aws_iam_session_context.current.issuer_arn
  booking_arn     = "${local.role_arn_prefix}/${var.booking_role_name}"
  payment_app_arn = "${local.role_arn_prefix}/${var.payment_app_role_name}"

  consume_actions = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"]

  # 큐 → { 허용 주체 } . 목록에 없는 주체의 해당 동작은 거부
  queue_access = {
    payment_result = {
      queue   = aws_sqs_queue.payment_result
      send    = [local.payment_app_arn, local.admin_arn]
      consume = [local.booking_arn]
    }
    payment_result_dlq = {
      queue   = aws_sqs_queue.payment_result_dlq
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
