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
  description = "서비스 루트 도메인. 등록한 도메인과 같아야 한다 (운영 계정 Route53 에서 등록). null 이면 Zone/인증서를 만들지 않는다"
  type        = string
  default     = "meomulm.click"
}

variable "enable_certificate" {
  description = "ACM 인증서 생성 여부. 도메인 NS 가 이 Zone 을 가리킨 뒤에 켠다 (dns.tf 상단 주석 참고)"
  type        = bool
  default     = true

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
  default     = false
}

variable "gitops_oidc_subject_prefix" {
  description = "gitops 레포 GitHub OIDC 토큰 sub 의 앞부분 (immutable subject 형식). 이 레포의 main 실행만 Role 을 받는다. 확인: gh api repos/<owner>/<repo>/actions/oidc/customization/sub 의 sub_claim_prefix"
  type        = string
  default     = "repo:Team-likelion-3rd-Project@336729042/likelion-devops-7th-3rd-team04-gitops@1421753380"
}

# ── 알림 (notifications.tf) ──

variable "deploy_publisher_role_names" {
  description = "배포 토픽에 발행하는 Role 이름 (매일 재생성 스택이 고정 이름으로 만든다). gitops_ssm_sync Role 은 자동 포함"
  type        = list(string)
  default = [
    "team04-hotel-deploy-notify", # 70 irsa.tf — 메인 클러스터 ArgoCD 배포 결과 알림
    "team04-hotel-payment-app",   # 60 iam.tf — 결제 서버 pull agent
  ]
}

variable "chatbot_region" {
  description = "AWS Chatbot 설정을 만들 리전. Chatbot API 는 us-east-1 엔드포인트가 없다"
  type        = string
  default     = "us-east-2"
}

# Slack ID 는 레포에 두지 않는다 — terraform.tfvars(gitignore) 에 넣는다. 기본값이 없어 빠지면 plan 이 멈춘다
# (null 로 건너뛰게 하면 tfvars 가 없는 apply 가 Chatbot 설정을 지운다)
variable "slack_team_id" {
  description = "Slack 워크스페이스 ID (T 로 시작). Chatbot 콘솔의 워크스페이스 상세"
  type        = string
}

variable "slack_alerts_channel_id" {
  description = "알람 채널(#alerts) ID (C 로 시작). Slack 채널 정보 하단"
  type        = string
}

variable "slack_deploy_channel_id" {
  description = "배포 결과 채널(#deploy) ID"
  type        = string
}
