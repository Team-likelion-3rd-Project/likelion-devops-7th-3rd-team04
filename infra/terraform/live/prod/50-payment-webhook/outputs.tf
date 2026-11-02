# 다른 스택은 dependency.payment_webhook.outputs.<이름> 처럼 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 큐 URL · ARN 은 output 하지 않는다. 사용하는 쪽이 이름으로 만든다

output "queue_names" {
  description = "큐 이름 (webhook, webhook_dlq)"
  value = {
    webhook     = aws_sqs_queue.webhook.name
    webhook_dlq = aws_sqs_queue.webhook_dlq.name
  }
}

output "lambda_function_name" {
  description = "Lambda 함수 이름 (90 알람)"
  value       = aws_lambda_function.webhook.function_name
}

output "api_id" {
  description = "API Gateway ID (90 알람)"
  value       = aws_apigatewayv2_api.webhook.id
}

output "webhook_url" {
  description = "토스 개발자센터에 등록하는 웹훅 주소"
  value       = "https://${local.webhook_domain}/webhook/toss"
}
