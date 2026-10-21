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

variable "log_bucket_name" {
  description = "10-global 장기 로그 버킷 이름 (Network Firewall flow 로그 대상)"
  type        = string
}

variable "single_nat_gateway" {
  description = "Main / Payment VPC 의 NAT 를 VPC 당 1개로 줄인다. 개발 기간 비용 절감용, 운영 시연 때 false 로 AZ 별 NAT"
  type        = bool
  default     = true
}

variable "enable_payment_network_firewall" {
  description = <<-EOT
    결제 VPC egress 를 Network Firewall 로 검사한다. false 면 app · lb 가 NAT 로 바로 나간다 (DNS Firewall · SG 는 유지).
    개발 기간 비용 절감용으로 기본은 끄고(엔드포인트 1개 시간당 $0.395), rc.3 전에 기본값을 true 로 바꾼다.
    하루만 켜서 검증할 때: terragrunt apply -var enable_payment_network_firewall=true
  EOT
  type        = bool
  default     = false
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

variable "payment_egress_allowed_sni" {
  description = <<-EOT
    결제 VPC 에서 NAT 로 나가는 HTTPS 를 허용할 도메인 (TLS SNI 완전 일치, 끝 점 없이).
    Network Firewall 이 이 목록 외 egress 를 차단한다. AWS 서비스는 VPC 엔드포인트로 가므로 넣지 않는다.
  EOT
  type        = list(string)
  default     = ["api.tosspayments.com"]

  validation {
    condition     = alltrue([for d in var.payment_egress_allowed_sni : can(regex("^[a-z0-9.-]+[a-z0-9]$", d))])
    error_message = "도메인은 소문자 FQDN 으로, 끝 점과 와일드카드 없이 적습니다."
  }
}

variable "payment_firewall_alert_log_retention_days" {
  description = "Network Firewall alert 로그(CloudWatch Logs) 보관 일수. 장기 보관은 S3 flow 로그가 맡는다"
  type        = number
  default     = 90
}
