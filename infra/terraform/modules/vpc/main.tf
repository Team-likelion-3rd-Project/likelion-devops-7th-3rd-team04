# VPC 하나와 계층별 서브넷, IGW, NAT, 라우트 테이블, 게이트웨이 엔드포인트.
#
# 라우트 테이블
#   public          : public 계층 공용, 0.0.0.0/0 → IGW
#   private-<az>    : NAT 경유 계층이 AZ 별로 공유, 0.0.0.0/0 → 같은 AZ 의 NAT (없으면 첫 번째 NAT)
#   isolated        : nat = false 계층 공용, 기본 경로 없음 (VPC 내부 + 게이트웨이 엔드포인트만)
#   firewall-<az>   : firewall 계층 전용, 0.0.0.0/0 → 같은 AZ 의 NAT
#
# NAT 가 없는 AZ(예: Main 의 cp-c) 와 single_nat_gateway = true 일 때는 첫 번째 NAT 로 나간다.
#
# firewall_endpoint_ids 를 주면 (결제 VPC egress 검사)
#   private-<az> 0.0.0.0/0 → NFW 엔드포인트 → firewall-<az> → NAT
#   public       <NAT 경유 서브넷 CIDR> → 같은 NFW 엔드포인트 (복귀 트래픽도 NFW 를 거치는 대칭 경로)
# 게이트웨이 엔드포인트(prefix list)와 VPC 내부(local) 트래픽은 더 구체적인 경로라 NFW 를 거치지 않는다.

data "aws_region" "current" {}

locals {
  region = data.aws_region.current.region

  # "<tier>-<az>" → 서브넷 하나
  subnets = merge([
    for tier, s in var.subnets : {
      for az, cidr in s.cidrs : "${tier}-${az}" => {
        tier     = tier
        az       = az
        cidr     = cidr
        public   = s.public
        firewall = s.firewall
        nat      = !s.public && !s.firewall && s.nat
        tags     = s.tags
      }
    }
  ]...)

  public_tier = one([for tier, s in var.subnets : tier if s.public])
  public_azs  = local.public_tier == null ? [] : sort(keys(var.subnets[local.public_tier].cidrs))

  private_azs  = sort(distinct([for s in values(local.subnets) : s.az if s.nat]))
  firewall_azs = sort(distinct([for s in values(local.subnets) : s.az if s.firewall]))
  has_isolated = anytrue([for s in values(local.subnets) : !s.public && !s.firewall && !s.nat])

  nat_azs = length(local.private_azs) + length(local.firewall_azs) == 0 ? [] : (
    var.single_nat_gateway ? [local.public_azs[0]] : local.public_azs
  )

  # AZ → 그 AZ 에서 나갈 NAT 키 (없으면 첫 번째 NAT)
  nat_for_az = { for az in distinct(concat(local.private_azs, local.firewall_azs)) : az => contains(local.nat_azs, az) ? az : local.nat_azs[0] }

  firewall_enabled      = length(var.firewall_endpoint_ids) > 0
  firewall_endpoint_azs = sort(keys(var.firewall_endpoint_ids))
  firewall_endpoint_for = { for az in local.private_azs : az => contains(local.firewall_endpoint_azs, az) ? var.firewall_endpoint_ids[az] : var.firewall_endpoint_ids[local.firewall_endpoint_azs[0]] if local.firewall_enabled }

  # 게이트웨이 엔드포인트를 붙일 라우트 테이블. firewall-<az> 는 검사를 마친 외부행 트래픽만 지나므로 제외한다
  route_table_ids = concat(
    aws_route_table.public[*].id,
    [for rt in aws_route_table.private : rt.id],
    aws_route_table.isolated[*].id,
  )
}

resource "aws_vpc" "this" {
  cidr_block = var.cidr_block

  # 인터페이스 엔드포인트 private DNS, Route53 Resolver 에 필요
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = {
    Name = var.name
  }
}

resource "aws_internet_gateway" "this" {
  count = local.public_tier == null ? 0 : 1

  vpc_id = aws_vpc.this.id

  tags = {
    Name = var.name
  }
}

resource "aws_subnet" "this" {
  for_each = local.subnets

  vpc_id            = aws_vpc.this.id
  cidr_block        = each.value.cidr
  availability_zone = "${local.region}${each.value.az}"

  tags = merge(
    {
      Name = "${var.name}-${each.key}"
      Tier = each.value.tier
    },
    each.value.tags,
  )
}

# ── NAT ─────────────────────────────────────────────

resource "aws_eip" "nat" {
  for_each = toset(local.nat_azs)

  domain = "vpc"

  tags = {
    Name = "${var.name}-nat-${each.key}"
  }
}

resource "aws_nat_gateway" "this" {
  for_each = toset(local.nat_azs)

  allocation_id = aws_eip.nat[each.key].id
  subnet_id     = aws_subnet.this["${local.public_tier}-${each.key}"].id

  tags = {
    Name = "${var.name}-${each.key}"
  }

  depends_on = [aws_internet_gateway.this]
}

# ── 라우트 테이블 ───────────────────────────────────

resource "aws_route_table" "public" {
  count = local.public_tier == null ? 0 : 1

  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.name}-public"
  }
}

resource "aws_route" "public_internet" {
  count = local.public_tier == null ? 0 : 1

  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this[0].id
}

resource "aws_route_table" "private" {
  for_each = toset(local.private_azs)

  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.name}-private-${each.key}"
  }
}

resource "aws_route" "private_nat" {
  for_each = toset(local.private_azs)

  route_table_id         = aws_route_table.private[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = local.firewall_enabled ? null : aws_nat_gateway.this[local.nat_for_az[each.key]].id
  vpc_endpoint_id        = local.firewall_enabled ? local.firewall_endpoint_for[each.key] : null
}

# NAT 에서 돌아오는 응답을 나갈 때 거친 NFW 엔드포인트로 되돌린다 (비대칭이면 NFW 가 흐름을 버린다)
resource "aws_route" "public_firewall_return" {
  for_each = local.firewall_enabled ? { for k, s in local.subnets : k => s if s.nat } : {}

  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = each.value.cidr
  vpc_endpoint_id        = local.firewall_endpoint_for[each.value.az]
}

resource "aws_route_table" "firewall" {
  for_each = toset(local.firewall_azs)

  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.name}-firewall-${each.key}"
  }
}

resource "aws_route" "firewall_nat" {
  for_each = toset(local.firewall_azs)

  route_table_id         = aws_route_table.firewall[each.key].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[local.nat_for_az[each.key]].id
}

resource "aws_route_table" "isolated" {
  count = local.has_isolated ? 1 : 0

  vpc_id = aws_vpc.this.id

  tags = {
    Name = "${var.name}-isolated"
  }
}

resource "aws_route_table_association" "this" {
  for_each = local.subnets

  subnet_id = aws_subnet.this[each.key].id
  route_table_id = (
    each.value.public ? aws_route_table.public[0].id :
    each.value.firewall ? aws_route_table.firewall[each.value.az].id :
    each.value.nat ? aws_route_table.private[each.value.az].id :
    aws_route_table.isolated[0].id
  )
}

# ── 게이트웨이 엔드포인트 (무료, NAT 처리 비용 절감) ──

resource "aws_vpc_endpoint" "gateway" {
  for_each = var.gateway_endpoints

  vpc_id            = aws_vpc.this.id
  service_name      = "com.amazonaws.${local.region}.${each.key}"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = local.route_table_ids

  tags = {
    Name = "${var.name}-${each.key}"
  }
}

# ── Flow Logs ──────────────────────────────────────

resource "aws_flow_log" "this" {
  count = var.flow_log_destination_arn == null ? 0 : 1

  vpc_id               = aws_vpc.this.id
  traffic_type         = "ALL"
  log_destination_type = "s3"
  log_destination      = var.flow_log_destination_arn

  tags = {
    Name = var.name
  }
}
