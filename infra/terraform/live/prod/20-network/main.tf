# 운영환경 VPC 3개. VPC 간 Peering / TGW 없이 메인 → 결제만 PrivateLink(60-payment-app) 로 잇는다.
#
# CIDR 은 서로, 그리고 아래 대역과 겹치지 않게 잡는다.
#   Calico 파드 10.0.0.0/16, kubeadm 서비스 10.96.0.0/12 (infra/ansible group_vars)
#   Tailscale 100.64.0.0/10, 온프레미스 192.168.0.0/16
#
#   VPC          CIDR            계층 (AZ)
#   Main         10.10.0.0/16    public(a·b) cp(a·b·c) db(a·b) worker(a·b, /19 — EKS VPC CNI 파드 IP 여유)
#   Payment      10.20.0.0/16    public(a·b) lb(a·b) app(a·b) db(a·b)
#   Deployment   10.30.0.0/16    public(a) runner(a)
#
# DB 계층은 NAT 경로 없이 isolated 라우트 테이블을 쓴다.

data "terraform_remote_state" "global" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "prod/global/terraform.tfstate"
    region = var.region
  }
}

locals {
  name = var.project
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

  single_nat_gateway = var.single_nat_gateway
  gateway_endpoints  = ["s3"]

  # 10-global 버킷 정책이 vpc-flow-logs/AWSLogs/<계정>/* 에만 쓰기를 허용한다
  flow_log_destination_arn = "${data.terraform_remote_state.global.outputs.log_bucket_arn}/vpc-flow-logs/"
}

# AZ 하나뿐이라 NAT 도 항상 1개
module "deployment" {
  source = "../../../modules/vpc"

  name       = "${local.name}-deployment"
  cidr_block = "10.30.0.0/16"

  subnets = {
    public = {
      public = true
      cidrs  = { a = "10.30.0.0/24" }
    }
    runner = {
      cidrs = { a = "10.30.4.0/24" }
    }
  }

  # 무료라 둔다. AL2023 패키지 저장소·ECR pull 레이어(S3) 트래픽만 NAT 를 우회한다
  # (ECR push 는 레이어도 dkr 엔드포인트로 올라가므로 NAT 를 거친다)
  gateway_endpoints = ["s3"]
}
