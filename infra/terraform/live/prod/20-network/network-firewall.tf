# 결제 VPC egress 검사용 AWS Network Firewall (분산형, 결제 VPC 안에만 둔다).
#
#   app · lb → NFW 엔드포인트(firewall 서브넷) → NAT → IGW, 복귀도 같은 엔드포인트 (modules/vpc firewall_endpoint_ids)
#   VPC 엔드포인트 · S3 게이트웨이 · 결제 DB 는 VPC 내부 경로라 NFW 를 거치지 않는다
#
# 규칙 (STRICT_ORDER, 위에서부터 처음 일치한 규칙에서 멈춘다)
#   1. 허용 목록 도메인의 TLS(SNI 완전 일치) 만 pass
#   2. 외부행 UDP · ICMP drop (SG 도 막지만 한 번 더)
#   3. 나머지는 기본 동작 drop_established + alert_established
#      drop_strict 로 두면 SNI 를 보기 전 TCP 핸드셰이크부터 막혀 허용 도메인도 연결되지 않는다.
#      SNI 없는 IP 직접 접속, 허용 목록 밖 도메인, 평문 HTTP 는 핸드셰이크 뒤 첫 데이터 패킷에서 막히고 alert 로그에 남는다.
#
# 엔드포인트 AZ 는 NAT 와 맞춘다 (single_nat_gateway = true 면 a 하나, false 면 a · b).
# 매일 재생성 대상이라 삭제 보호를 끈다.

locals {
  payment_firewall_azs = var.single_nat_gateway ? [sort(keys(local.payment_firewall_cidrs))[0]] : sort(keys(local.payment_firewall_cidrs))

  # 키(AZ)는 plan 시점에 정해져 있어야 모듈의 for_each 가 동작한다. 값(엔드포인트 ID)은 apply 후 정해진다
  payment_firewall_endpoint_by_subnet = {
    for s in aws_networkfirewall_firewall.payment.firewall_status[0].sync_states :
    s.attachment[0].subnet_id => s.attachment[0].endpoint_id
  }
  payment_firewall_endpoint_ids = {
    for az in local.payment_firewall_azs :
    az => local.payment_firewall_endpoint_by_subnet[module.payment.subnet_ids_by_az.firewall[az]]
  }

  payment_egress_rules = join("\n", concat(
    [
      for i, domain in var.payment_egress_allowed_sni :
      "pass tls $HOME_NET any -> $EXTERNAL_NET 443 (flow:to_server, established; tls.sni; content:\"${domain}\"; startswith; endswith; nocase; msg:\"allow TLS SNI ${domain}\"; sid:${1000001 + i}; rev:1;)"
    ],
    [
      "drop udp $HOME_NET any -> $EXTERNAL_NET any (msg:\"drop egress UDP\"; sid:1100001; rev:1;)",
      "drop icmp $HOME_NET any -> $EXTERNAL_NET any (msg:\"drop egress ICMP\"; sid:1100002; rev:1;)",
    ],
  ))
}

resource "aws_networkfirewall_rule_group" "payment_egress" {
  name = "${local.name}-payment-egress"
  type = "STATEFUL"

  # 생성 후 바꿀 수 없다 (바꾸면 교체). 허용 도메인이 늘어도 충분하게 잡는다
  capacity = 100

  rule_group {
    rule_variables {
      ip_sets {
        key = "HOME_NET"
        ip_set {
          definition = [module.payment.vpc_cidr]
        }
      }
    }

    rules_source {
      rules_string = local.payment_egress_rules
    }

    stateful_rule_options {
      rule_order = "STRICT_ORDER"
    }
  }
}

resource "aws_networkfirewall_firewall_policy" "payment" {
  name = "${local.name}-payment"

  firewall_policy {
    stateless_default_actions          = ["aws:forward_to_sfe"]
    stateless_fragment_default_actions = ["aws:forward_to_sfe"]

    stateful_engine_options {
      rule_order = "STRICT_ORDER"
    }
    stateful_default_actions = ["aws:drop_established", "aws:alert_established"]

    stateful_rule_group_reference {
      priority     = 100
      resource_arn = aws_networkfirewall_rule_group.payment_egress.arn
    }
  }
}

resource "aws_networkfirewall_firewall" "payment" {
  name                = "${local.name}-payment"
  firewall_policy_arn = aws_networkfirewall_firewall_policy.payment.arn
  vpc_id              = module.payment.vpc_id

  delete_protection                 = false
  subnet_change_protection          = false
  firewall_policy_change_protection = false

  dynamic "subnet_mapping" {
    for_each = local.payment_firewall_azs

    content {
      subnet_id = module.payment.subnet_ids_by_az.firewall[subnet_mapping.value]
    }
  }
}

# ── 로그 ───────────────────────────────────────────
#   ALERT : CloudWatch Logs (차단 · 알람 확인용). /aws/vendedlogs/ 접두사면 로그 전달 리소스 정책 크기 제한을 피한다
#   FLOW  : 10-global 로그 버킷 network-firewall/ (장기 보관, 버킷 정책은 10-global 이 연다)

resource "aws_cloudwatch_log_group" "payment_firewall_alert" {
  name              = "/aws/vendedlogs/${local.name}/payment-network-firewall/alert"
  retention_in_days = var.payment_firewall_alert_log_retention_days
}

resource "aws_networkfirewall_logging_configuration" "payment" {
  firewall_arn = aws_networkfirewall_firewall.payment.arn

  logging_configuration {
    log_destination_config {
      log_type             = "ALERT"
      log_destination_type = "CloudWatchLogs"
      log_destination = {
        logGroup = aws_cloudwatch_log_group.payment_firewall_alert.name
      }
    }

    log_destination_config {
      log_type             = "FLOW"
      log_destination_type = "S3"
      log_destination = {
        bucketName = var.log_bucket_name
        prefix     = "network-firewall"
      }
    }
  }
}
