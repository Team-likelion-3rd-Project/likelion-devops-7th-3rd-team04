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

variable "main_vpc_id" {
  description = "20-network Main VPC ID"
  type        = string
}

variable "enable_control_plane" {
  description = "kubeadm 컨트롤 플레인 SG(main-cp, main-internal-nlb) 와 관련 규칙 생성 여부. 20-network 의 enable_control_plane_subnets 와 짝, EKS 전환 후 false"
  type        = bool
  default     = true
}
