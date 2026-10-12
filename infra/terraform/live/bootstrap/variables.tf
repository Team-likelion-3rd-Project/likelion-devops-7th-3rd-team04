variable "project" {
  description = "리소스 태그에 사용할 프로젝트 이름"
  type        = string
  default     = "team04-hotel"
}

variable "environment" {
  description = "환경 이름 (bootstrap 은 모든 환경이 공유)"
  type        = string
  default     = "shared"
}

variable "region" {
  description = "state 버킷을 생성할 리전"
  type        = string
  default     = "us-east-1"
}

variable "state_bucket_name" {
  description = "Terraform state 버킷 이름 (전역 고유, 공개 저장소이므로 계정 ID 는 넣지 않는다)"
  type        = string
  default     = "team04-hotel-tfstate"
}

variable "noncurrent_version_retention_days" {
  description = "이전 버전 state 파일 보관 기간(일)"
  type        = number
  default     = 90
}
