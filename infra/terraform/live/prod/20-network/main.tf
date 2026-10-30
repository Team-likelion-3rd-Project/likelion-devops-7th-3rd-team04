# 운영환경 VPC 2개. VPC 간 Peering / TGW 없이 메인 → 결제만 PrivateLink(60-payment-app) 로 잇는다.
#
# CIDR 은 서로, 그리고 아래 대역과 겹치지 않게 잡는다.
#   Calico 파드 10.0.0.0/16, kubeadm 서비스 10.96.0.0/12 (infra/ansible group_vars)
#   Tailscale 100.64.0.0/10, 온프레미스 192.168.0.0/16
#
#   VPC          CIDR            계층 (AZ)
#   Main         10.10.0.0/16    public(a·b) cp(a·b·c) db(a·b) worker(a·b, /19 — EKS VPC CNI 파드 IP 여유)
#   Payment      10.20.0.0/16    public(a·b) firewall(a·b, /28) lb(a·b) app(a·b) db(a·b)#
# DB 계층은 NAT 경로 없이 isolated 라우트 테이블을 쓴다.
# 결제 VPC 의 lb · app 계층 egress 는 Network Firewall(network-firewall.tf) 을 거쳐 NAT 로 나간다.

locals {
  name = var.project

  payment_firewall_cidrs = { a = "10.20.2.0/28", b = "10.20.2.16/28" }

  # 결제 app-a 서브넷에서 고정 IP 를 쓰는 인스턴스용 대역 (61-payment-mock). 아래 예약 참고
  payment_app_static_cidr = "10.20.8.16/28"
}

module "main" {
  source = "../../../modules/vpc"

  name       = "${local.name}-main"
  cidr_block = "10.10.0.0/16"

  subnets = merge(
    {
      public = {
        public = true
        cidrs  = { a = "10.10.0.0/24", b = "10.10.1.0/24" }
        tags   = var.main_public_subnet_tags
      }
      db = {
        nat   = false
        cidrs = { a = "10.10.8.0/24", b = "10.10.9.0/24" }
      }
      worker = {
        cidrs = { a = "10.10.32.0/19", b = "10.10.64.0/19" }
        tags  = var.main_worker_subnet_tags
      }
    },
    var.enable_control_plane_subnets ? {
      cp = {
        cidrs = { a = "10.10.4.0/24", b = "10.10.5.0/24", c = "10.10.6.0/24" }
      }
    } : {},
  )

  single_nat_gateway = var.single_nat_gateway
  gateway_endpoints  = ["s3", "dynamodb"]
}

module "payment" {
  source = "../../../modules/vpc"

  name       = "${local.name}-payment"
  cidr_block = "10.20.0.0/16"

  subnets = {
    public = {
      public = true
      cidrs  = { a = "10.20.0.0/24", b = "10.20.1.0/24" }
    }
    firewall = {
      firewall = true
      cidrs    = local.payment_firewall_cidrs
    }
    lb = {
      cidrs = { a = "10.20.4.0/24", b = "10.20.5.0/24" }
    }
    app = {
      cidrs = { a = "10.20.8.0/24", b = "10.20.9.0/24" }
    }
    db = {
      nat   = false
      cidrs = { a = "10.20.12.0/24", b = "10.20.13.0/24" }
    }
  }

  single_nat_gateway    = var.single_nat_gateway
  gateway_endpoints     = ["s3"]
  firewall_endpoint_ids = local.payment_firewall_endpoint_ids

  # 10-global 버킷 정책이 vpc-flow-logs/AWSLogs/<계정>/* 에만 쓰기를 허용한다
  flow_log_destination_arn = "${var.log_bucket_arn}/vpc-flow-logs/"
}

# 결제 app-a 서브넷의 고정 IP 대역. explicit 예약 대역은 AWS 가 자동 할당하지 않으므로
# 44 인터페이스 엔드포인트 · 60 결제 서버 ENI 가 먼저 떠도 고정 IP(61 pg-mock) 와 겹치지 않는다
resource "aws_ec2_subnet_cidr_reservation" "payment_app_static" {
  subnet_id        = module.payment.subnet_ids_by_az.app.a
  cidr_block       = local.payment_app_static_cidr
  reservation_type = "explicit"
  description      = "Static IPs for payment VPC instances (PG mock)"
}
