variable "project_id" {
  description = "GCP 프로젝트 ID"
  type        = string
  default     = "likelion-devops-7th-3rd-team4"
}

variable "region" {
  description = "state 버킷 리전"
  type        = string
  default     = "asia-northeast3"
}

variable "terraform_service_account" {
  description = "impersonate 할 Terraform 실행용 서비스 계정"
  type        = string
  default     = "terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com"
}

variable "state_bucket_name" {
  description = "Terraform state 버킷 이름 (전역 고유)"
  type        = string
  default     = "likelion-devops-7th-3rd-team4-tfstate"
}

variable "noncurrent_version_retention_days" {
  description = "이전 버전 state 파일 보관 기간(일)"
  type        = number
  default     = 90
}
