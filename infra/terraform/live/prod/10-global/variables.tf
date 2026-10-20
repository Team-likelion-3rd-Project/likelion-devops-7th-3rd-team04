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
  description = "리전 (CloudFront 용 ACM 인증서가 us-east-1 이어야 하므로 고정)"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "서비스 루트 도메인 (예: example.click). 등록한 도메인과 같아야 한다. null 이면 Zone/인증서를 만들지 않는다"
  type        = string
  default     = null
}

variable "enable_certificate" {
  description = "ACM 인증서 생성 여부. NS 위임이 끝난 뒤에 true 로 바꾼다 (dns.tf 상단 주석 참고)"
  type        = bool
  default     = false

  validation {
    condition     = !var.enable_certificate || var.domain_name != null
    error_message = "enable_certificate 를 켜려면 domain_name 이 필요합니다."
  }
}

variable "log_bucket_name" {
  description = "장기 로그 버킷 이름 (전역 고유, 공개 저장소이므로 계정 ID 는 넣지 않는다)"
  type        = string
  default     = "team04-hotel-logs"
}

variable "log_object_lock_days" {
  description = "로그 객체 Object Lock 보관 기간(일). 이 기간 동안 삭제/덮어쓰기 불가"
  type        = number
  default     = 7
}

variable "log_retention_days" {
  description = "로그 객체 보관 기간(일). 지나면 lifecycle 로 삭제 (Object Lock 기간보다 길어야 한다)"
  type        = number
  default     = 90

  validation {
    condition     = var.log_retention_days > var.log_object_lock_days
    error_message = "log_retention_days 는 log_object_lock_days 보다 커야 합니다."
  }
}

variable "oidc_bucket_name" {
  description = "자체 IRSA OIDC 발급자 문서를 둘 공개 버킷 이름 (전역 고유, 공개 저장소이므로 계정 ID 는 넣지 않는다)"
  type        = string
  default     = "team04-hotel-oidc"
}

# ── GitHub OIDC (gitops → Parameter Store, github-oidc.tf) ──

variable "create_github_oidc_provider" {
  description = "GitHub OIDC 공급자(token.actions.githubusercontent.com)를 이 스택에서 만든다. 계정에 하나만 존재할 수 있어, 다른 팀이 먼저 만들었으면 false 로 두고 기존 공급자를 쓴다"
  type        = bool
  default     = true
}

variable "gitops_repository" {
  description = "결제 서버 이미지 태그를 Parameter Store 에 쓰는 GitHub 레포 (owner/name). 이 레포의 main 실행만 Role 을 받는다"
  type        = string
  default     = "Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04-gitops"
}
