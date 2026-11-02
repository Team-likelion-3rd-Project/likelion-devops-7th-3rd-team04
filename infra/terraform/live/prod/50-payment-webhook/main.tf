# 토스 웹훅 수신. 메인 VPC 를 거치지 않고 결제 VPC 로 받는다 (LDP-206).
#
#   토스 ── HTTPS ──▶ API Gateway(pay-webhook.<도메인>) ──▶ Lambda(결제 VPC) ── SQS 엔드포인트 ──▶ payment-webhook
#                                                                                                     │ Receive · Delete
#                                                           payment-webhook-dlq ◀── 처리 실패 ──── payment-service(60)
#
# Lambda 코드는 백엔드가 lambda/index.mjs 로 관리하고, 이 스택은 패키징 · 배포와 큐 URL 주입(WEBHOOK_QUEUE_URL)만 한다.
# 웹훅 내용은 믿지 않는다. payment-service 가 토스 조회 API 로 재확인한 뒤 처리하므로 위조 웹훅은 그 단계에서 걸러진다.
#
# 매일 재생성 스택이라 내려가 있는 동안의 웹훅은 토스 재전송(최대 7회, 약 3일 19시간)에 의존한다.
# 200 을 응답한 뒤 큐에 남은 메시지는 destroy 하면 사라지고 재전송도 없다 → destroy 전에 큐 · DLQ 가 비었는지 확인한다.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  name = "${var.project}-payment-webhook"

  role_arn_prefix = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role"
  admin_arn       = data.aws_iam_session_context.current.issuer_arn
  lambda_role_arn = aws_iam_role.lambda.arn
  payment_app_arn = "${local.role_arn_prefix}/${var.payment_app_role_name}"
  webhook_domain  = "${var.webhook_subdomain}.${var.domain_name}"
}
