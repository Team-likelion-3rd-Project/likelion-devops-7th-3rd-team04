# 메인 VPC 쪽 결제 PrivateLink: Interface Endpoint 와 고정 이름(private hosted zone).
#
#   api-gateway · booking-service 파드 → payment.team04-hotel.internal:3004
#     → VPC Resolver → private zone alias → 엔드포인트 ENI(worker 서브넷 a · b)   SG: 30-security main_worker → main_privatelink (M13)
#     → Endpoint Service(60-payment-app) → 결제 NLB → 결제 서버
#
# 엔드포인트 DNS 이름(vpce-...vpce-svc-....vpce.amazonaws.com)은 재생성마다 바뀐다.
# 메인 VPC 에만 연결한 private zone 의 고정 이름으로 alias 해서 gitops values(PAYMENT_SERVICE_HOST)를 고치지 않게 한다.
# .internal 은 사설망 전용으로 예약된 최상위 도메인이라 공개 도메인과 겹치지 않는다.
# 결제 VPC 에는 zone 을 연결하지 않는다 (결제 → 메인 이름 해석 경로 없음).
#
# 70(메인 클러스터)과 같은 단계라 서로 참조하지 않고 병렬로 생성된다. 70 은 60 · 71 을 기다리지 않는다.

locals {
  name = "${var.project}-payment-link"
}

resource "aws_vpc_endpoint" "payment" {
  vpc_id             = var.main_vpc_id
  service_name       = var.endpoint_service_name
  vpc_endpoint_type  = "Interface"
  subnet_ids         = var.worker_subnet_ids
  security_group_ids = [var.sg_ids["main_privatelink"]]

  # Endpoint Service 에 프라이빗 DNS 이름이 없다. 이름은 아래 private zone 이 붙인다
  private_dns_enabled = false

  tags = {
    Name = local.name
  }
}

resource "aws_route53_zone" "internal" {
  name    = var.internal_zone_name
  comment = "Main VPC internal names (payment PrivateLink)"

  vpc {
    vpc_id = var.main_vpc_id
  }

  # 매일 재생성. Terraform 밖에서 추가한 레코드가 있어도 지운다
  force_destroy = true

  tags = {
    Name = var.internal_zone_name
  }
}

# 엔드포인트 DNS 의 첫 항목은 리전 이름(모든 AZ ENI). AZ 별 이름은 쓰지 않는다
resource "aws_route53_record" "payment" {
  zone_id = aws_route53_zone.internal.zone_id
  name    = "${var.payment_record_name}.${var.internal_zone_name}"
  type    = "A"

  alias {
    name                   = aws_vpc_endpoint.payment.dns_entry[0].dns_name
    zone_id                = aws_vpc_endpoint.payment.dns_entry[0].hosted_zone_id
    evaluate_target_health = false
  }
}
