# ALB 앞 WAF (REGIONAL).
#
#   0  rate limit           IP 하나가 평가 기간 동안 waf_rate_limit 회를 넘으면 차단
#   1  IP reputation        AWS 위협 인텔리전스의 악성 IP (봇, 스캐너)
#   2  Common rule set      OWASP Top 10 계열 (XSS, LFI, 본문 8KB 초과 등)
#   3  Known bad inputs     Log4Shell 등 알려진 악성 입력
#
# 객실 이미지는 Presigned PUT 으로 S3 에 직접 올리므로(LDP-88) API 본문은 8KB 를 넘지 않는다.
# 그래서 본문 크기 제한(SizeRestrictions_BODY)도 예외 없이 그대로 차단한다.
#
# 차단 응답은 403. 규칙별 차단 수는 CloudWatch 지표(WAFV2 네임스페이스) 로 본다.

locals {
  # count_rules: 차단 대신 count(라벨만 붙임)로 바꿀 규칙
  waf_managed_rule_groups = {
    "AWSManagedRulesAmazonIpReputationList" = { priority = 1, count_rules = [] }
    "AWSManagedRulesCommonRuleSet"          = { priority = 2, count_rules = [] }
    "AWSManagedRulesKnownBadInputsRuleSet"  = { priority = 3, count_rules = [] }
  }
}

resource "aws_wafv2_web_acl" "main" {
  name  = "${local.name}-alb"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "rate-limit-per-ip"
    priority = 0

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit                 = var.waf_rate_limit
        evaluation_window_sec = var.waf_rate_limit_window_sec
        aggregate_key_type    = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-limit-per-ip"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.waf_managed_rule_groups

    content {
      name     = rule.key
      priority = rule.value.priority

      # 관리형 규칙 그룹 자체의 동작(block)을 그대로 쓴다
      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.key

          dynamic "rule_action_override" {
            for_each = rule.value.count_rules

            content {
              name = rule_action_override.value

              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }

  tags = {
    Name = "${local.name}-alb"
  }
}

resource "aws_wafv2_web_acl_association" "main" {
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.main.arn
}
