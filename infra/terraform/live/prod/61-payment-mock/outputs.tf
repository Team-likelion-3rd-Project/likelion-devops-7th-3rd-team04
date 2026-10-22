# 확인용. 60-payment-app 은 같은 단계라 이 output 대신 같은 규칙(pg_mock_private_ip_hostnum)으로 주소를 만든다.
# IP 는 예약 대역 안의 고정값이라 재생성해도 같다

output "pg_mock_url" {
  description = "결제 서버 PG_MOCK_SERVICE_URL (enable_pg_mock = false 면 null)"
  value       = var.enable_pg_mock ? "http://${local.private_ip}:${var.mock_port}" : null
}
