# ALB 앞 WAF (REGIONAL).
#
#   0  rate limit           IP 하나가 평가 기간 동안 waf_rate_limit 회를 넘으면 차단
#   1  IP reputation        AWS 위협 인텔리전스의 악성 IP (봇, 스캐너)
#   2  Common rule set      OWASP Top 10 계열 (XSS, LFI, 크기 제한 등). SizeRestrictions_BODY 는 count(라벨만)
#   3  body size            위 라벨이 붙은 요청(본문 8KB 초과)을 큰 본문 허용 경로 외에서 차단
#   4  Known bad inputs     Log4Shell 등 알려진 악성 입력
#
# 객실 이미지 등록 · 수정 API 는 Base64 이미지를 JSON 본문에 담아 8KB 를 넘는다.
# ALB 의 WAF 는 본문 앞 8KB 만 검사할 수 있어 Common 규칙이 그대로 차단하므로, 이 경로만 크기 제한에서 뺀다.
# 앞 8KB 는 다른 규칙(XSS 등)으로 계속 검사한다.
#
# 차단 응답은 403. 규칙별 차단 수는 CloudWatch 지표(WAFV2 네임스페이스) 로 본다.

locals {
  # count_rules: 차단 대신 count(라벨만 붙임)로 바꿀 규칙
  waf_managed_rule_groups = {
    "AWSManagedRulesAmazonIpReputationList" = { priority = 1, count_rules = [] }
    "AWSManagedRulesCommonRuleSet"          = { priority = 2, count_rules = ["SizeRestrictions_BODY"] }
    "AWSManagedRulesKnownBadInputsRuleSet"  = { priority = 4, count_rules = [] }
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

  # Common rule set(우선순위 2) 이 붙인 라벨을 읽으므로 그 뒤에 평가해야 한다
  rule {
    name     = "body-size-limit"
    priority = 3

    action {
      block {}
    }

    statement {
      and_statement {
        statement {
          label_match_statement {
            scope = "LABEL"
            key   = "awswaf:managed:aws:core-rule-set:SizeRestrictions_Body"
          }
        }

        statement {
          not_statement {
            statement {
              regex_match_statement {
                regex_string = var.waf_large_body_path_regex

                field_to_match {
                  uri_path {}
                }

                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "body-size-limit"
      sampled_requests_enabled   = true
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
