# Payment VPC SG 와 규칙 (설계 문서 4-2절 P3 – P5)
#
# 결제 앱은 아웃바운드를 443 과 결제 DB 3306 만 연다. 외부 도메인은 20-network 의 DNS Firewall(이름 해석)과
# Network Firewall(TLS SNI) 이 한 번 더 제한한다.
# DB · 엔드포인트 ENI 는 아웃바운드가 없다.
# Amazon DNS(VPC+2) · IMDS · Time Sync(169.254.169.123) 는 SG 가 거르지 않으므로 규칙이 필요 없다.
#
# payment_nlb (P1 · P2), payment_lambda (P6), main_privatelink (M13) 는 결제 웹훅 · 결제 앱 + PrivateLink 이슈에서 추가한다.

locals {
  payment_security_groups = {
    payment_app  = { vpc = "payment", description = "Payment service instances" }
    payment_db   = { vpc = "payment", description = "Payment RDS MariaDB" }
    payment_vpce = { vpc = "payment", description = "Payment VPC interface endpoints" }
  }

  payment_ingress_rules = {
    # P3 payment-service · Flyway → 결제 DB
    p3_db_from_app = { sg = "payment_db", source = "payment_app", port = 3306, description = "P3 MariaDB from payment app" }

    # P4 결제 앱 → 인터페이스 엔드포인트 (ECR · SSM · SQS · Secrets Manager · Logs)
    p4_vpce_from_app = { sg = "payment_vpce", source = "payment_app", port = 443, description = "P4 HTTPS from payment app" }
  }

  payment_egress_rules = {
    p3_app_to_db = { sg = "payment_app", source = "payment_db", port = 3306, description = "P3 MariaDB to payment DB" }

    # P5 토스 API(NAT), 인터페이스 엔드포인트(P4 의 출발 쪽), S3 게이트웨이 엔드포인트(prefix list).
    # 토스 API IP 가 고정돼 있지 않아 CIDR 로 좁히지 않는다
    p5_app_https = { sg = "payment_app", cidr = "0.0.0.0/0", port = 443, description = "P5 HTTPS (Toss API via NAT, VPC endpoints)" }
  }
}
