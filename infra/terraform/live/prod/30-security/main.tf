# 스택 사이에서 참조되는 SG 와 SG 규칙. 설계는 위키 "보안 그룹 설계" 문서를 따른다.
#
# - SG · 규칙 정의는 VPC 별 파일(sg-<vpc>.tf)의 locals 에 두고, 이 파일에서 merge 해 for_each 로 만든다.
#   결제 · PrivateLink SG 는 결제 이슈에서 sg-payment.tf 를 추가한다. Runner SG 는 sg-deployment.tf.
# - 규칙은 인라인 블록 대신 aws_vpc_security_group_*_rule 로 만든다. SG 끼리 서로 참조해도 순환이 생기지 않는다.
# - Terraform 은 SG 생성 시 AWS 기본 아웃바운드(전체 허용)를 지운다. 아웃바운드도 모두 규칙으로 적는다.
# - SG · 규칙 description 은 AWS 가 ASCII 만 허용한다. 한글 설명은 주석으로 적는다.

locals {
  name = var.project

  vpc_ids = {
    main       = var.main_vpc_id
    deployment = var.deployment_vpc_id
  }

  # 키는 <vpc>_<역할>. SG 이름은 team04-hotel-<vpc>-<역할>, output 키도 같은 값
  security_groups = merge(
    local.main_security_groups,
    local.deployment_security_groups,
  )

  # 규칙 공통 기본값. 단일 포트는 port, 범위는 from_port / to_port, 출처(대상)는 source(SG 키) 또는 cidr
  rule_defaults = {
    protocol  = "tcp"
    port      = null
    from_port = null
    to_port   = null
    source    = null
    cidr      = null
  }

  ingress_rules = {
    for k, r in merge(local.main_ingress_rules, local.deployment_ingress_rules) : k => merge(local.rule_defaults, r)
  }

  egress_rules = {
    for k, r in merge(local.main_egress_rules, local.deployment_egress_rules) : k => merge(local.rule_defaults, r)
  }
}

resource "aws_security_group" "this" {
  for_each = local.security_groups

  name        = "${local.name}-${replace(each.key, "_", "-")}"
  description = each.value.description
  vpc_id      = local.vpc_ids[each.value.vpc]

  tags = {
    Name = "${local.name}-${replace(each.key, "_", "-")}"
  }
}

# source: 출처 SG
resource "aws_vpc_security_group_ingress_rule" "this" {
  for_each = local.ingress_rules

  security_group_id = aws_security_group.this[each.value.sg].id
  description       = each.value.description

  ip_protocol = each.value.protocol
  from_port   = each.value.protocol == "-1" ? null : coalesce(each.value.from_port, each.value.port)
  to_port     = each.value.protocol == "-1" ? null : coalesce(each.value.to_port, each.value.port)

  referenced_security_group_id = each.value.source == null ? null : aws_security_group.this[each.value.source].id
  cidr_ipv4                    = each.value.cidr

  tags = {
    Name = each.key
  }
}

# source: 대상 SG
resource "aws_vpc_security_group_egress_rule" "this" {
  for_each = local.egress_rules

  security_group_id = aws_security_group.this[each.value.sg].id
  description       = each.value.description

  ip_protocol = each.value.protocol
  from_port   = each.value.protocol == "-1" ? null : coalesce(each.value.from_port, each.value.port)
  to_port     = each.value.protocol == "-1" ? null : coalesce(each.value.to_port, each.value.port)

  referenced_security_group_id = each.value.source == null ? null : aws_security_group.this[each.value.source].id
  cidr_ipv4                    = each.value.cidr

  tags = {
    Name = each.key
  }
}
