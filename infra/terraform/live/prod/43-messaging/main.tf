# 결제 결과 전달 큐. 결제 앱(결제 VPC) 의 Outbox 가 보내고, 메인 클러스터 booking-service 가 받아 Inbox 에 반영한다.
#
#   결제 앱 ── SendMessage ──▶ payment-result.fifo ── Receive · Delete ──▶ booking-service (IRSA)
#                                  │ maxReceiveCount 회 받고도 지워지지 않으면
#                                  ▼
#                              payment-result-dlq.fifo (관리자가 확인 · 재처리)
#
#   MessageGroupId = 예약 ID (같은 예약 이벤트는 순서대로), MessageDeduplicationId = outbox event_id (5분 중복 제거)
#
# 큐 이름이 고정이라 재생성 후에도 큐 URL 이 같다. 큐 URL · ARN 에는 계정 ID 가 들어가므로 output 하지 않고 이름만 output 한다.

resource "aws_sqs_queue" "payment_result_dlq" {
  name                    = var.payment_result_dlq_name
  fifo_queue              = true
  sqs_managed_sse_enabled = true

  # 최대값. 원본 큐 보관 기간이 지나도 DLQ 에서는 사라지지 않게 한다 (DLQ 로 옮겨도 보관 기간은 최초 전송 시각 기준)
  message_retention_seconds = 1209600 # 14일
}

resource "aws_sqs_queue" "payment_result" {
  name                        = var.payment_result_queue_name
  fifo_queue                  = true
  content_based_deduplication = false # 발행 쪽이 MessageDeduplicationId(event_id) 를 넣는다
  sqs_managed_sse_enabled     = true
  visibility_timeout_seconds  = var.payment_result_visibility_timeout

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.payment_result_dlq.arn
    maxReceiveCount     = var.payment_result_max_receive_count
  })
}

# DLQ 는 이 원본 큐의 메시지만 받는다
resource "aws_sqs_queue_redrive_allow_policy" "payment_result_dlq" {
  queue_url = aws_sqs_queue.payment_result_dlq.id

  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.payment_result.arn]
  })
}
