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
  description = "리전 (CloudFront 에 붙이는 ACM 인증서가 us-east-1 에 있어야 하므로 고정)"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "서비스 루트 도메인. 10-global domain_name 과 같아야 한다 (Zone · 인증서를 이 이름으로 조회)"
  type        = string
  default     = "meomulm.click"
}

# ── 버킷 (전역 고유, 공개 저장소이므로 계정 ID 는 넣지 않는다) ──

variable "site_bucket_name" {
  description = "프론트 빌드 버킷 이름. releases/<main 커밋 SHA>/ 아래에 버전별로 둔다 (40-cicd 가 output 으로 받아 Runner 업로드 권한을 만든다)"
  type        = string
  default     = "team04-hotel-frontend"
}

variable "image_bucket_name" {
  description = "객실 사진 버킷 이름 (room-types/<객실 id>/<uuid>.<확장자>). gitops backend values 의 hotel-service S3_BUCKET 과 같아야 한다 (70 은 output 으로 받는다)"
  type        = string
  default     = "team04-hotel-room-images"
}

variable "release_retention_days" {
  description = "사이트 버킷 releases/ 객체 보관 기간(일). 지나면 수명 주기로 삭제한다 — 이 기간 안의 버전으로만 롤백할 수 있고, 이 기간 동안 새 릴리스가 없으면 현재 버전도 지워지므로 넉넉하게"
  type        = number
  default     = 180
}

# ── 쓰기 주체 (버킷 정책이 이 Role 과 관리자만 쓰기를 허용, Role 이름은 다른 스택이 만든다) ──

variable "ci_runner_role_name" {
  description = "프론트 빌드를 올리는 40-cicd Runner IAM Role 이름"
  type        = string
  default     = "team04-hotel-ci-runner"
}

variable "image_writer_role_name" {
  description = "객실 사진 Presigned PUT 을 서명 · 삭제하는 hotel-service IRSA Role 이름 (70 irsa_roles 의 hotel-service)"
  type        = string
  default     = "team04-hotel-hotel-service"
}

variable "release_sync_role_name" {
  description = "gitops main GitHub Actions 가 assume 하는 Role 이름 (10-global gitops_ssm_sync_role_name). 이 스택이 KeyValueStore 버전 갱신 권한을 붙인다"
  type        = string
  default     = "team04-hotel-gitops-ssm-sync"
}

# ── CloudFront ──

variable "price_class" {
  description = "CloudFront 가격 등급. PriceClass_200 은 한국 · 일본 엣지를 포함한다 (PriceClass_100 은 북미 · 유럽만이라 한국 사용자가 먼 엣지에서 응답받음)"
  type        = string
  default     = "PriceClass_200"
}
