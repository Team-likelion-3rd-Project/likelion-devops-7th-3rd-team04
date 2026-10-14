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

variable "state_bucket" {
  description = "다른 스택 state 를 읽을 버킷 (backend.hcl 의 bucket 과 같아야 한다)"
  type        = string
  default     = "team04-hotel-tfstate"
}

variable "enable_control_plane" {
  description = "kubeadm 컨트롤 플레인 SG(main-cp, main-internal-nlb) 와 관련 규칙 생성 여부. 20-network 의 enable_control_plane_subnets 와 짝, EKS 전환 후 false"
  type        = bool
  default     = true
}
