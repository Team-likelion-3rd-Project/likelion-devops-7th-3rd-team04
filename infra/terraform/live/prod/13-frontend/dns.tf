# 루트 · www → CloudFront (IPv4 · IPv6). api. 는 80-main-edge 가 만든다
locals {
  alias_records = {
    for pair in setproduct([var.domain_name, local.www_domain], ["A", "AAAA"]) :
    "${pair[0]}-${pair[1]}" => { name = pair[0], type = pair[1] }
  }
}

resource "aws_route53_record" "alias" {
  for_each = local.alias_records

  zone_id = data.aws_route53_zone.main.zone_id
  name    = each.value.name
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.main.domain_name
    zone_id                = aws_cloudfront_distribution.main.hosted_zone_id
    evaluate_target_health = false
  }
}
