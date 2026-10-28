# Main 클러스터 앞단 퍼블릭 ALB 와 WAF.
#
#   인터넷 → ALB(public 서브넷) → 워커 NodePort 30080 → Traefik → 파드
#
# 10-global 에 인증서가 없으면(도메인 구매 전) HTTP(80) 로 바로 전달하고,
# 인증서가 생기면 80 → 443 리다이렉트 + 443 에서 전달로 바뀐다. Zone 이 있으면 api.<도메인> · grafana.<도메인> 레코드도 만든다.
# SG 는 30-security 의 main_alb(M1 80 · 443 인바운드, M2 워커 30080 아웃바운드) 를 쓴다.

locals {
  name = "${var.project}-main"

  network = var.main_network
  sg_ids  = var.sg_ids

  certificate_arn = var.certificate_arn
  zone_id         = var.zone_id
  domain_name     = var.domain_name
  https_enabled   = local.certificate_arn != null
  zone_enabled    = local.zone_id != null
}
