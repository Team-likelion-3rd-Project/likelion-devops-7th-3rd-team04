output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.this.id
}

output "vpc_cidr" {
  description = "VPC CIDR"
  value       = aws_vpc.this.cidr_block
}

output "subnet_ids" {
  description = "계층 → 서브넷 ID 목록 (AZ 순)"
  value = {
    for tier, s in var.subnets : tier => [
      for az in sort(keys(s.cidrs)) : aws_subnet.this["${tier}-${az}"].id
    ]
  }
}

output "subnet_ids_by_az" {
  description = "계층 → AZ 접미사 → 서브넷 ID (특정 AZ 에 하나만 둘 리소스용)"
  value = {
    for tier, s in var.subnets : tier => {
      for az in keys(s.cidrs) : az => aws_subnet.this["${tier}-${az}"].id
    }
  }
}

output "route_table_ids" {
  description = "라우트 테이블 ID (public / private AZ 별 / isolated, 없으면 null 또는 빈 맵)"
  value = {
    public   = one(aws_route_table.public[*].id)
    private  = { for az, rt in aws_route_table.private : az => rt.id }
    isolated = one(aws_route_table.isolated[*].id)
  }
}

output "nat_public_ips" {
  description = "AZ → NAT 공인 IP (외부 서비스 IP 허용 목록 등록용)"
  value       = { for az, eip in aws_eip.nat : az => eip.public_ip }
}
