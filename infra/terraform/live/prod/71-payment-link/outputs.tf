output "payment_service_host" {
  description = "gitops backend values 의 PAYMENT_SERVICE_HOST (api-gateway · booking-service). 재생성해도 같다"
  value       = "${aws_route53_record.payment.fqdn}:${var.grpc_port}"
}
