# 토스가 호출하는 공개 입구. 라우트는 POST /webhook/toss 하나이고, 기본 execute-api 주소는 꺼서 커스텀 도메인으로만 받는다.
# WAF 는 쓰지 않는다 (HTTP API 미지원). 요청량은 아래 스로틀링으로 제한하고, 넘으면 429 → 토스 재전송.

resource "aws_apigatewayv2_api" "webhook" {
  name                         = local.name
  protocol_type                = "HTTP"
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.webhook.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.webhook.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "toss" {
  api_id    = aws_apigatewayv2_api.webhook.id
  route_key = "POST /webhook/toss"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.webhook.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_rate_limit  = var.throttling_rate_limit
    throttling_burst_limit = var.throttling_burst_limit
  }
}

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.webhook.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.webhook.execution_arn}/*/POST/webhook/toss"
}

resource "aws_apigatewayv2_domain_name" "webhook" {
  domain_name = local.webhook_domain

  domain_name_configuration {
    certificate_arn = var.certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "webhook" {
  api_id      = aws_apigatewayv2_api.webhook.id
  domain_name = aws_apigatewayv2_domain_name.webhook.id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "webhook" {
  zone_id = var.zone_id
  name    = local.webhook_domain
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.webhook.domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.webhook.domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
