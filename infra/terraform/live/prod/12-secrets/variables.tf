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

variable "release_role_name" {
  description = "GitHub App Secret 을 읽는 모노레포 release.yml Role 이름 (Role 은 10-global monorepo_release_role_name 에서 생성)"
  type        = string
  default     = "team04-hotel-release"
}

variable "payment_app_role_name" {
  description = "토스 시크릿 키 Secret 을 읽는 60-payment-app 결제 서버 Role 이름 (Role 은 60 에서 생성)"
  type        = string
  default     = "team04-hotel-payment-app"
}

variable "external_secrets_role_name" {
  description = "시드 관리자 계정 Secret 을 읽는 External Secrets Operator Role 이름 (Role 은 70 irsa_roles 에서 생성)"
  type        = string
  default     = "team04-hotel-external-secrets"
}

# ── 비밀값 (ephemeral: state · plan 에 남지 않음). terragrunt.hcl 이 .env 를 읽어 TF_VAR_* 로 넘긴다 (README 5절) ──

# ── GitHub App (gitops 릴리스 PR). App ID · Installation ID 는 App 설정 화면, 개인 키는 레포 밖 파일(12-secrets/.env 의 GITHUB_APP_PRIVATE_KEY_FILE)에서 넘긴다 (Terraform README 5절) ──

variable "github_app_credentials_version" {
  description = "GitHub App Secret 값을 다시 넣을 때 올리는 번호 (개인 키 교체 등)"
  type        = number
  default     = 1
}

variable "github_app_id" {
  description = "GitHub App ID (숫자). 비밀은 아니지만 개인 키와 함께 한 Secret 으로 둔다"
  type        = string
  ephemeral   = true

  validation {
    condition     = can(regex("^[0-9]+$", var.github_app_id))
    error_message = "TF_VAR_github_app_id 가 비었거나 숫자가 아닙니다."
  }
}

variable "github_app_installation_id" {
  description = "gitops 레포에 설치된 GitHub App 의 Installation ID (숫자)"
  type        = string
  ephemeral   = true

  validation {
    condition     = can(regex("^[0-9]+$", var.github_app_installation_id))
    error_message = "TF_VAR_github_app_installation_id 가 비었거나 숫자가 아닙니다."
  }
}

variable "github_app_private_key" {
  description = "GitHub App 개인 키 (PEM 전체)"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.github_app_private_key, "-----BEGIN")
    error_message = "TF_VAR_github_app_private_key 가 비었거나 PEM 형식이 아닙니다."
  }
}

# ── 토스페이먼츠 (결제 서버 TOSS_SECRET_KEY). 결제위젯 연동 키의 시크릿 키 — 테스트 test_gsk_*, 라이브 live_gsk_* (API 개별 연동 키는 *_sk_*) ──

variable "toss_credentials_version" {
  description = "토스 시크릿 키 Secret 값을 다시 넣을 때 올리는 번호 (테스트 → 라이브 전환, 키 재발급 등)"
  type        = number
  default     = 1
}

variable "toss_secret_key" {
  description = "토스페이먼츠 시크릿 키. 클라이언트 키(*_gck_*)는 toss_client_key 로 따로 넣는다"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = can(regex("^(test|live)_g?sk_", var.toss_secret_key))
    error_message = "TF_VAR_toss_secret_key 가 비었거나 시크릿 키(test_sk_ · live_sk_ · test_gsk_ · live_gsk_) 형식이 아닙니다."
  }
}

variable "toss_client_key" {
  description = "토스 결제위젯 클라이언트 키 (프론트 VITE_TOSS_CLIENT_KEY, 공개용). toss_secret_key 와 같은 줄의 한 쌍. 12-secrets/.env 의 TOSS_CLIENT_KEY"
  type        = string
  ephemeral   = true

  validation {
    condition     = can(regex("^(test|live)_gck_", var.toss_client_key))
    error_message = "TF_VAR_toss_client_key 가 비었거나 결제위젯 클라이언트 키(test_gck_ · live_gck_) 형식이 아닙니다."
  }
}

# ── 시드 관리자 계정 (backend 시드 Job 의 SEED_ADMIN_*, LDP-141). 운영 관리자 로그인 계정이라 사람이 정해 둔다 ──

variable "seed_admin_credentials_version" {
  description = "시드 관리자 계정 Secret 값을 다시 넣을 때 올리는 번호 (비밀번호 변경 등). 다음 DB 재생성부터 새 값으로 시딩된다"
  type        = number
  default     = 1
}

variable "seed_admin_email" {
  description = "시드 관리자 로그인 이메일. 12-secrets/.env 의 SEED_ADMIN_EMAIL"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = can(regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", var.seed_admin_email))
    error_message = "TF_VAR_seed_admin_email 이 비었거나 이메일 형식이 아닙니다."
  }
}

variable "seed_admin_password" {
  description = "시드 관리자 비밀번호 (12자 이상). 12-secrets/.env 의 SEED_ADMIN_PASSWORD"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = length(var.seed_admin_password) >= 12
    error_message = "TF_VAR_seed_admin_password 가 비었거나 12자보다 짧습니다."
  }
}

variable "seed_admin_name" {
  description = "시드 관리자 표시 이름. 12-secrets/.env 의 SEED_ADMIN_NAME"
  type        = string
  ephemeral   = true

  validation {
    condition     = length(trimspace(var.seed_admin_name)) > 0
    error_message = "TF_VAR_seed_admin_name 이 비었습니다."
  }
}

variable "grafana_admin_credentials_version" {
  description = "Grafana admin Secret 값을 다시 넣을 때 올리는 번호 (비밀번호 변경). 다음 클러스터 재생성(또는 ESO refresh 1시간)부터 반영"
  type        = number
  default     = 1
}

variable "grafana_admin_password" {
  description = "운영 Grafana admin 비밀번호 (16자 이상, 로그인 이름은 admin). 12-secrets/.env 의 GRAFANA_ADMIN_PASSWORD"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = length(var.grafana_admin_password) >= 16
    error_message = "TF_VAR_grafana_admin_password 가 비었거나 16자보다 짧습니다."
  }
}
