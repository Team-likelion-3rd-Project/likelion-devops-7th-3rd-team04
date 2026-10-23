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

variable "ci_runner_role_name" {
  description = "Runner Secret 을 읽는 40-cicd Runner IAM Role 이름 (Role 은 40 에서 생성)"
  type        = string
  default     = "team04-hotel-ci-runner"
}

variable "payment_app_role_name" {
  description = "토스 시크릿 키 Secret 을 읽는 60-payment-app 결제 서버 Role 이름 (Role 은 60 에서 생성)"
  type        = string
  default     = "team04-hotel-payment-app"
}

# ── 비밀값 (ephemeral: state · plan 에 남지 않음). terragrunt.hcl 이 .env 를 읽어 TF_VAR_* 로 넘긴다 (README 5절) ──

variable "ci_runner_credentials_version" {
  description = "Runner Secret 값을 다시 넣을 때 올리는 번호. write-only 값은 생성 시와 이 값이 바뀔 때만 전달된다"
  type        = number
  default     = 1
}

variable "ci_runner_tailscale_oauth_client_secret" {
  description = "Tailscale OAuth client secret (tag:ci-runner). 12-secrets/.env 의 TS_CI_RUNNER_OAUTH_CLIENT_SECRET"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_tailscale_oauth_client_secret, "tskey-client-")
    error_message = "TF_VAR_ci_runner_tailscale_oauth_client_secret 이 비었거나 tskey-client- 로 시작하지 않습니다."
  }
}

variable "ci_runner_gitlab_url" {
  description = "온프레미스 GitLab URL (https://<gitlab>.<tailnet>.ts.net). 12-secrets/.env 의 GITLAB_URL"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_gitlab_url, "https://")
    error_message = "TF_VAR_ci_runner_gitlab_url 이 비었거나 https:// 로 시작하지 않습니다."
  }
}

variable "ci_runner_gitlab_token" {
  description = "AWS Runner(aws-ci-runner) 인증 토큰. 12-secrets/.env 의 GITLAB_RUNNER_TOKEN"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_gitlab_token, "glrt-")
    error_message = "TF_VAR_ci_runner_gitlab_token 이 비었거나 glrt- 로 시작하지 않습니다."
  }
}

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
