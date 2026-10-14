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

variable "control_plane_instance_type" {
  description = "컨트롤 플레인 인스턴스 타입 (arm64). kubeadm 최소 요건 2 vCPU · 2GB"
  type        = string
  default     = "t4g.medium"
}

variable "worker_instance_type" {
  description = "워커 인스턴스 타입 (arm64)"
  type        = string
  default     = "t4g.large"
}

variable "worker_desired_capacity" {
  description = "워커 ASG 희망 대수"
  type        = number
  default     = 2
}

variable "worker_min_size" {
  description = "워커 ASG 최소 대수"
  type        = number
  default     = 2
}

variable "worker_max_size" {
  description = "워커 ASG 최대 대수"
  type        = number
  default     = 4
}

variable "root_volume_size" {
  description = "노드(CP · 워커) 루트 볼륨 크기 (GiB, gp3)"
  type        = number
  default     = 30
}
