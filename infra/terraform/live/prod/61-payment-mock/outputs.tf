# 결제 서버 설정(LDP-116)이 쓰는 값. IP 는 예약 대역 안의 고정값이라 재생성해도 같다

output "pg_mock_url" {
  description = "결제 서버 PG_MOCK_SERVICE_URL (enable_pg_mock = false 면 null)"
  value       = var.enable_pg_mock ? "http://${local.private_ip}:${var.mock_port}" : null
}
