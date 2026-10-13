# 결제 VPC 의 Route53 Resolver DNS Firewall.
# 허용 목록 외 도메인은 이름 해석 단계에서 막아, 결제 서버가 토스 API 외의 외부로 나가지 못하게 한다.
# (IP 직접 접속은 30-security 의 결제 앱 SG egress 443 제한으로 막는다)
#
# 규칙은 priority 오름차순으로 평가되고 처음 일치한 규칙에서 멈춘다.

resource "aws_route53_resolver_firewall_domain_list" "payment_allowed" {
  name    = "${local.name}-payment-allowed"
  domains = var.payment_dns_allowed_domains
}

resource "aws_route53_resolver_firewall_domain_list" "all" {
  name    = "${local.name}-payment-all"
  domains = ["*."]
}

resource "aws_route53_resolver_firewall_rule_group" "payment" {
  name = "${local.name}-payment"
}

resource "aws_route53_resolver_firewall_rule" "payment_allow" {
  name                    = "allow-listed"
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.payment.id
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.payment_allowed.id
  priority                = 100
  action                  = "ALLOW"
}

resource "aws_route53_resolver_firewall_rule" "payment_block" {
  name                    = "block-all"
  firewall_rule_group_id  = aws_route53_resolver_firewall_rule_group.payment.id
  firewall_domain_list_id = aws_route53_resolver_firewall_domain_list.all.id
  priority                = 200
  action                  = "BLOCK"
  block_response          = "NXDOMAIN"
}

resource "aws_route53_resolver_firewall_rule_group_association" "payment" {
  name                   = "${local.name}-payment"
  firewall_rule_group_id = aws_route53_resolver_firewall_rule_group.payment.id
  vpc_id                 = module.payment.vpc_id
  priority               = 101
}

# Resolver 장애 시 질의를 통과시키지 않는다 (결제 VPC 는 차단 쪽이 안전)
resource "aws_route53_resolver_firewall_config" "payment" {
  resource_id        = module.payment.vpc_id
  firewall_fail_open = "DISABLED"
}
