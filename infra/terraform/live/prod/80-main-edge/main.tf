# Main 클러스터 앞단 퍼블릭 ALB 와 WAF.
#
#   인터넷 → ALB(public 서브넷) → 워커 NodePort 30080 → Traefik → 파드
#
# 10-global 에 인증서가 없으면(도메인 구매 전) HTTP(80) 로 바로 전달하고,
# 인증서가 생기면 80 → 443 리다이렉트 + 443 에서 전달로 바뀐다. Zone 이 있으면 api.<도메인> 레코드도 만든다.
# SG 는 30-security 의 main_alb(M1 80 · 443 인바운드, M2 워커 30080 아웃바운드) 를 쓴다.

data "terraform_remote_state" "global" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "prod/global/terraform.tfstate"
    region = var.region
  }
}

data "terraform_remote_state" "network" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "prod/network/terraform.tfstate"
    region = var.region
  }
}

data "terraform_remote_state" "security" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "prod/security/terraform.tfstate"
    region = var.region
  }
}

data "terraform_remote_state" "main_cluster" {
  backend = "s3"

  config = {
    bucket = var.state_bucket
    key    = "prod/main-cluster-kubeadm/terraform.tfstate"
    region = var.region
  }
}

locals {
  name = "${var.project}-main"

  global  = data.terraform_remote_state.global.outputs
  network = data.terraform_remote_state.network.outputs.main
  sg_ids  = data.terraform_remote_state.security.outputs.sg_ids

  # 값이 null 인 output 은 state 에 저장되지 않아 속성 자체가 없다 (도메인 · 인증서 생성 전)
  certificate_arn = try(local.global.certificate_arn, null)
  zone_id         = try(local.global.zone_id, null)
  domain_name     = try(local.global.domain_name, null)
  https_enabled   = local.certificate_arn != null
  zone_enabled    = local.zone_id != null
}
