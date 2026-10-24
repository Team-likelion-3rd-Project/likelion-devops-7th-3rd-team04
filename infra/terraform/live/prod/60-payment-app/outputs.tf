# 다른 스택은 dependency.payment_app.outputs.<이름> 처럼 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 ARN 은 output 하지 않는다

output "endpoint_service_name" {
  description = "VPC Endpoint Service 이름 (com.amazonaws.vpce.<리전>.vpce-svc-...). 71-payment-link 가 Interface Endpoint 를 만든다"
  value       = aws_vpc_endpoint_service.app.service_name
}

output "grpc_port" {
  description = "결제 gRPC 포트 (PAYMENT_SERVICE_HOST 의 포트)"
  value       = var.grpc_port
}

output "asg_name" {
  description = "결제 서버 ASG 이름 (인스턴스 확인 · 교체 테스트용)"
  value       = aws_autoscaling_group.app.name
}

output "nlb_arn_suffix" {
  description = "결제 NLB arn_suffix (90-observability-alarms CloudWatch 지표 LoadBalancer 차원)"
  value       = aws_lb.app.arn_suffix
}

output "target_group_arn_suffix" {
  description = "결제 서버 Target Group arn_suffix (90-observability-alarms CloudWatch 지표 TargetGroup 차원)"
  value       = aws_lb_target_group.app.arn_suffix
}

output "deploy_log_group_name" {
  description = "pull agent 배포 이벤트 로그 그룹 (90-observability-alarms 지표 필터)"
  value       = aws_cloudwatch_log_group.deploy.name
}
