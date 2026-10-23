# 서비스 도메인 Hosted Zone 과 ACM 인증서.
#
# 도메인이 없어도 apply 할 수 있도록 변수로 단계를 나눈다.
# 도메인 구매 전에는 domain_name = null 로 두면 Zone/인증서 없이 나머지 리소스만 생성된다.
# NS 가 이 Zone 을 가리키기 전에 인증서를 만들면 DNS 검증이 끝나지 않아 timeout 나므로 enable_certificate 는 마지막에 켠다.
#
# Route53 에서 도메인을 등록하면 등록 계정에 Hosted Zone 이 자동 생성되고 NS 도 그 Zone 을 가리킨다.
# 그래서 도메인을 어느 계정에서 샀는지에 따라 절차가 다르다.
#
# [A] 이 계정(운영 계정)에서 구매 — 자동 생성된 Zone 을 가져온다. NS 변경 없음 (meomulm.click 은 이 방식)
#   1) Route53 에서 도메인 구매 (자동 갱신 해제, 등록자 이메일 인증). 등록 완료까지 수십 분
#   2) variables.tf 의 domain_name 기본값을 등록한 도메인으로, enable_certificate 기본값을 true 로 설정
#      (tfvars 는 gitignore 라 다른 사람이 apply 해도 같은 결과가 나오도록 기본값에 둔다)
#   3) Zone ID 확인: aws route53 list-hosted-zones-by-name --dns-name <도메인>
#   4) AWS_PROFILE=team04 terragrunt import -var enable_certificate=false 'aws_route53_zone.main[0]' <자동 생성된 Zone ID>
#      (인증서를 켠 채로 import 하면 acm_validation for_each 키를 알 수 없어 실패한다)
#   5) TLD 에 NS 위임이 보일 때까지 대기: dig +short NS <도메인> @8.8.8.8 이 Zone 의 NS 4개를 반환 (등록 완료 후 수 분 – 수십 분)
#   6) AWS_PROFILE=team04 terragrunt apply
#   Zone 은 prevent_destroy 라 state 를 잃어도 다시 import 만 하면 된다
#
# [B] 다른 계정에서 구매 — 등록 계정의 이름 서버를 이 Zone 의 NS 로 바꿔 위임한다
#   1) terraform.tfvars 에 domain_name 설정 → apply (Zone 만 생성)
#   2) 등록 계정에서 이름 서버를 output name_servers 4개로 변경 → dig NS <도메인> 으로 확인
#   3) 등록 계정에 자동 생성된 Zone 삭제 (12시간 안에 지우면 요금 없음)
#   4) enable_certificate = true → apply

locals {
  domain_enabled      = var.domain_name != null
  certificate_enabled = local.domain_enabled && var.enable_certificate
}

resource "aws_route53_zone" "main" {
  count = local.domain_enabled ? 1 : 0

  name = var.domain_name

  lifecycle {
    prevent_destroy = true
  }
}

# 루트 + 와일드카드 하나로 모든 서브도메인(api., www., pay-webhook. 등)을 처리한다.
# CloudFront 에서도 쓰려면 us-east-1 에 있어야 한다.
resource "aws_acm_certificate" "main" {
  count = local.certificate_enabled ? 1 : 0

  domain_name               = var.domain_name
  subject_alternative_names = ["*.${var.domain_name}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# 루트와 와일드카드는 검증 레코드가 같으므로 allow_overwrite 로 중복 생성 충돌을 피한다
resource "aws_route53_record" "acm_validation" {
  for_each = local.certificate_enabled ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}

  zone_id         = aws_route53_zone.main[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count = local.certificate_enabled ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.acm_validation : r.fqdn]
}
