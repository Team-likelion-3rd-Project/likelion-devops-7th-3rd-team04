# Payment VPC SG 와 규칙 (설계 문서 4-2절 P1 – P5, P7)
#
# 결제 앱은 아웃바운드를 443, 결제 DB 3306, pg-mock 3007 만 연다. 외부 도메인은 20-network 의 DNS Firewall(이름 해석)과
# Network Firewall(TLS SNI) 이 한 번 더 제한한다.
# DB · 엔드포인트 ENI 는 아웃바운드가 없다.
# Amazon DNS(VPC+2) · IMDS · Time Sync(169.254.169.123) 는 SG 가 거르지 않으므로 규칙이 필요 없다.
#
# 메인 → 결제는 PrivateLink 하나다 (60-payment-app, 71-payment-link).
#   메인 워커 → main_privatelink(엔드포인트 ENI, sg-main.tf M13) → 결제 NLB → 결제 앱 3004
#   결제 NLB 는 PrivateLink 트래픽에 SG 인바운드 규칙을 적용하지 않는다 (60 nlb.tf). 그래서 payment_nlb 에는 인바운드 규칙이 없고,
#   결제 VPC 안의 다른 주체는 NLB 에 붙을 수 없다. PrivateLink 로 들어오는 쪽은 Endpoint Service 허용 주체와 M13 이 제한한다.
#
# pg-mock(부하 테스트용 토스 대체) 은 결제 앱과 분리한 인스턴스다 (61-payment-mock). 결제 앱만 mock 포트로 붙는다.
#
# payment_lambda (P6) 는 결제 웹훅 이슈에서 추가한다.

locals {
  payment_security_groups = {
    payment_app  = { vpc = "payment", description = "Payment service instances" }
    payment_db   = { vpc = "payment", description = "Payment RDS MariaDB" }
    payment_vpce = { vpc = "payment", description = "Payment VPC interface endpoints" }
    payment_nlb  = { vpc = "payment", description = "Payment internal NLB (PrivateLink endpoint service)" }
    payment_mock = { vpc = "payment", description = "Payment PG mock instance (load test)" }
  }

  payment_ingress_rules = {
    # P3 payment-service · Flyway → 결제 DB
    p3_db_from_app = { sg = "payment_db", source = "payment_app", port = 3306, description = "P3 MariaDB from payment app" }

    # P4 결제 앱 → 인터페이스 엔드포인트 (ECR · SSM · SQS · Secrets Manager · Logs)
    p4_vpce_from_app  = { sg = "payment_vpce", source = "payment_app", port = 443, description = "P4 HTTPS from payment app" }
    p4_vpce_from_mock = { sg = "payment_vpce", source = "payment_mock", port = 443, description = "P4 HTTPS from payment PG mock" }

    # P1 · P2 결제 NLB → 결제 앱 gRPC, 헬스체크(HTTP /health). Target Group preserve_client_ip = false 라 출처가 NLB
    p1_app_grpc_from_nlb   = { sg = "payment_app", source = "payment_nlb", port = var.payment_grpc_port, description = "P1 payment gRPC from payment NLB" }
    p2_app_health_from_nlb = { sg = "payment_app", source = "payment_nlb", port = var.payment_health_port, description = "P2 payment health check from payment NLB" }

    # P7 결제 앱 → pg-mock (PAYMENT_PROVIDER=MOCK)
    p7_mock_from_app = { sg = "payment_mock", source = "payment_app", port = var.payment_mock_port, description = "P7 PG mock from payment app" }
  }

  payment_egress_rules = {
    p3_app_to_db = { sg = "payment_app", source = "payment_db", port = 3306, description = "P3 MariaDB to payment DB" }

    # P5 토스 API(NAT), 인터페이스 엔드포인트(P4 의 출발 쪽), S3 게이트웨이 엔드포인트(prefix list).
    # 토스 API IP 가 고정돼 있지 않아 CIDR 로 좁히지 않는다
    p5_app_https = { sg = "payment_app", cidr = "0.0.0.0/0", port = 443, description = "P5 HTTPS (Toss API via NAT, VPC endpoints)" }

    # P1 · P2 NLB 는 대상 포트만
    p1_nlb_to_app_grpc   = { sg = "payment_nlb", source = "payment_app", port = var.payment_grpc_port, description = "P1 payment gRPC to payment app" }
    p2_nlb_to_app_health = { sg = "payment_nlb", source = "payment_app", port = var.payment_health_port, description = "P2 payment health check to payment app" }

    p7_app_to_mock = { sg = "payment_app", source = "payment_mock", port = var.payment_mock_port, description = "P7 PG mock to PG mock instance" }

    # mock 은 외부로 나갈 일이 없다. 인터페이스 엔드포인트(ECR · SSM) 와 S3 게이트웨이 엔드포인트(ECR 레이어 · dnf) 만.
    # S3 게이트웨이는 prefix list 대상이라 CIDR 로 연다 (NFW · DNS Firewall 이 외부 도메인을 한 번 더 막는다)
    p4_mock_https = { sg = "payment_mock", cidr = "0.0.0.0/0", port = 443, description = "P4 HTTPS (VPC endpoints, S3 gateway)" }
  }
}
