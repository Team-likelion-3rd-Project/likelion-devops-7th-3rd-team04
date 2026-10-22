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
