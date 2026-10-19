variable "project" {
  description = "리소스 이름/태그에 사용할 프로젝트 이름"
  type        = string
  default     = "team04-hotel"
}

variable "environment" {
  description = "환경 이름"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "리전"
  type        = string
  default     = "us-east-1"
}

# ── 다른 스택 output (terragrunt.hcl 의 dependency 가 넣는다) ──

variable "log_bucket_arn" {
  description = "10-global 장기 로그 버킷 ARN (Flow Logs 대상)"
  type        = string
}

variable "single_nat_gateway" {
  description = "Main / Payment VPC 의 NAT 를 VPC 당 1개로 줄인다. 개발 기간 비용 절감용, 운영 시연 때 false 로 AZ 별 NAT"
  type        = bool
  default     = true
}

variable "enable_control_plane_subnets" {
  description = "Main VPC 의 kubeadm 컨트롤 플레인 서브넷(a·b·c) 생성 여부. EKS 전환 후 false"
  type        = bool
  default     = true
}

variable "main_public_subnet_tags" {
  description = "Main public 서브넷 추가 태그. EKS 전환 시 { \"kubernetes.io/role/elb\" = \"1\" }"
  type        = map(string)
  default     = {}
}

variable "main_worker_subnet_tags" {
  description = "Main worker 서브넷 추가 태그. EKS 전환 시 { \"kubernetes.io/role/internal-elb\" = \"1\" }"
  type        = map(string)
  default     = {}
}

variable "payment_dns_allowed_domains" {
  description = <<-EOT
    결제 VPC 에서 이름 해석을 허용할 도메인. 나머지는 DNS Firewall 이 차단한다.
    외부(NAT) 로 나가는 도메인은 토스 API 뿐이고, AWS 도메인은 엔드포인트·RDS 이름 해석용이다
    (DNS Firewall 은 엔드포인트 private DNS 질의도 걸러내므로 함께 허용해야 한다).
  EOT
  type        = list(string)
  default = [
    "api.tosspayments.com.",
    "*.amazonaws.com.",
    "*.ec2.internal.",
  ]
}
