# 다른 스택은 dependency.messaging.outputs.<이름> 처럼 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 큐 URL · ARN 은 output 하지 않는다. 사용하는 쪽이 이름으로 만든다
#   ARN : arn:aws:sqs:<리전>:<계정>:<이름>
#   URL : https://sqs.<리전>.amazonaws.com/<계정>/<이름>  (PAYMENT_RESULT_QUEUE_URL, 재생성해도 같음)

output "queue_names" {
  description = "큐 이름 (payment_result, payment_result_dlq)"
  value = {
    payment_result     = aws_sqs_queue.payment_result.name
    payment_result_dlq = aws_sqs_queue.payment_result_dlq.name
  }
}
