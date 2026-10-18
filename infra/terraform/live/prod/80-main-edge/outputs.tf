# 다른 스택은 dependency.main_edge.outputs.<이름> 처럼 읽는다.

output "alb_dns_name" {
  description = "ALB DNS 이름 (도메인 구매 전 접속 주소)"
  value       = aws_lb.main.dns_name
}

output "api_url" {
  description = "API 접속 URL. 인증서가 있으면 https, Zone 이 있으면 api.<도메인>"
  value = format("%s://%s",
    local.https_enabled ? "https" : "http",
    local.zone_enabled ? one(aws_route53_record.api[*].fqdn) : aws_lb.main.dns_name,
  )
}

output "alb_arn_suffix" {
  description = "ALB arn_suffix (90-observability-alarms CloudWatch 지표 LoadBalancer 차원)"
  value       = aws_lb.main.arn_suffix
}

output "target_group_arn_suffix" {
  description = "워커 Target Group arn_suffix (90-observability-alarms CloudWatch 지표 TargetGroup 차원)"
  value       = aws_lb_target_group.worker.arn_suffix
}
