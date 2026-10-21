variable "project_id" {
  description = "GCP 프로젝트 ID"
  type        = string
  default     = "likelion-devops-7th-3rd-team4"
}

variable "region" {
  description = "기본 리전"
  type        = string
  default     = "asia-northeast3"
}

variable "terraform_service_account" {
  description = "impersonate 할 Terraform 실행용 서비스 계정"
  type        = string
  default     = "terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com"
}

variable "llm_service_account_id" {
  description = "온프레미스 dev 클러스터의 llm-service 가 Vertex AI 를 호출할 때 쓰는 서비스 계정 ID"
  type        = string
  default     = "llm-service-dev"
}
