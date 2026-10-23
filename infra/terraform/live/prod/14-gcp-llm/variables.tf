variable "project" {
  description = "리소스 이름에 사용할 프로젝트 이름"
  type        = string
  default     = "team04-hotel"
}

variable "environment" {
  description = "환경 이름"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS 리전 (OIDC 발급자 버킷 주소에 사용)"
  type        = string
  default     = "us-east-1"
}

# ── GCP ──

variable "gcp_project_id" {
  description = "GCP 프로젝트 ID (온프레미스 dev 와 같은 프로젝트)"
  type        = string
  default     = "likelion-devops-7th-3rd-team4"
}

variable "gcp_region" {
  description = "GCP 기본 리전"
  type        = string
  default     = "asia-northeast3"
}

variable "terraform_service_account" {
  description = "impersonate 할 Terraform 실행용 서비스 계정"
  type        = string
  default     = "terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com"
}

# ── Workload Identity Federation ──

variable "oidc_bucket_name" {
  description = "메인 클러스터 OIDC 발급자 문서 버킷. 10-global oidc_bucket_name 과 같아야 한다 (발급자 = https://<버킷>.s3.<region>.amazonaws.com)"
  type        = string
  default     = "team04-hotel-oidc"
}

variable "workload_identity_pool_id" {
  description = "Workload Identity Pool ID. 삭제 후 30일 동안 같은 ID 를 쓸 수 없으므로 바꾸지 않는다"
  type        = string
  default     = "team04-hotel-prod"
}

variable "workload_identity_provider_id" {
  description = "Pool 안 OIDC Provider ID (메인 클러스터 ServiceAccount 토큰 발급자)"
  type        = string
  default     = "main-cluster"
}

variable "allowed_namespace" {
  description = "토큰 교환을 허용할 쿠버네티스 네임스페이스. 다른 네임스페이스 토큰은 Provider 단계에서 거부한다"
  type        = string
  default     = "backend"
}

variable "llm_service_account_id" {
  description = "운영 llm-service 가 Vertex AI 를 호출할 때 impersonate 하는 GCP 서비스 계정 ID (키는 만들지 않는다)"
  type        = string
  default     = "llm-service-prod"
}

variable "kubernetes_service_accounts" {
  description = "운영 GCP 서비스 계정을 쓸 수 있는 쿠버네티스 ServiceAccount 이름 (allowed_namespace 안)"
  type        = set(string)
  default = [
    "llm-service", # 챗봇 답변 · 질의 임베딩
    "llm-ingest",  # RAG 문서 적재 Job (문서 임베딩)
  ]
}

variable "credential_token_path" {
  description = "파드 안 projected ServiceAccount 토큰 경로. output credential_config 의 credential_source.file 로 들어가며, 차트의 projected 볼륨 경로와 같아야 한다"
  type        = string
  default     = "/var/run/secrets/gcp/token"
}
