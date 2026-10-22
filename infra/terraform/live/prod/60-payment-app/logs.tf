# 결제 서버 로그 (44 logs 엔드포인트로 보낸다). 매일 재생성 때 함께 지워진다. 장기 보관은 관측 이슈(Fluent Bit → 로그 버킷)
#   app     payment-service 컨테이너 출력 (docker awslogs 드라이버, 스트림 <instance-id>/payment-service)
#   deploy  pull agent 의 배포 · 실패 · 롤백 이벤트 (JSON 한 줄, 스트림 <instance-id>). 알람은 관측 이슈

resource "aws_cloudwatch_log_group" "app" {
  name              = "/${var.project}/${var.environment}/payment/app"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "deploy" {
  name              = "/${var.project}/${var.environment}/payment/deploy"
  retention_in_days = var.log_retention_days
}
