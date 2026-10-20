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

# ── 비밀값 (ephemeral: state · plan 에 남지 않음). 환경변수 TF_VAR_* 로 넘긴다 (README 5절) ──

variable "ci_runner_credentials_version" {
  description = "Runner Secret 값을 다시 넣을 때 올리는 번호. write-only 값은 생성 시와 이 값이 바뀔 때만 전달된다"
  type        = number
  default     = 1
}

variable "ci_runner_tailscale_oauth_client_secret" {
  description = "Tailscale OAuth client secret (tag:ci-runner). infra/ansible/.env 의 TS_CI_RUNNER_OAUTH_CLIENT_SECRET"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_tailscale_oauth_client_secret, "tskey-client-")
    error_message = "TF_VAR_ci_runner_tailscale_oauth_client_secret 이 비었거나 tskey-client- 로 시작하지 않습니다."
  }
}

variable "ci_runner_gitlab_url" {
  description = "온프레미스 GitLab URL (https://<gitlab>.<tailnet>.ts.net). infra/ansible/.secrets/aws-ci-runner.env 의 GITLAB_URL"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_gitlab_url, "https://")
    error_message = "TF_VAR_ci_runner_gitlab_url 이 비었거나 https:// 로 시작하지 않습니다."
  }
}

variable "ci_runner_gitlab_token" {
  description = "AWS Runner(aws-ci-runner) 인증 토큰. infra/ansible/.secrets/aws-ci-runner.env 의 GITLAB_RUNNER_TOKEN"
  type        = string
  ephemeral   = true
  sensitive   = true

  validation {
    condition     = startswith(var.ci_runner_gitlab_token, "glrt-")
    error_message = "TF_VAR_ci_runner_gitlab_token 이 비었거나 glrt- 로 시작하지 않습니다."
  }
}

# ── GitHub App (gitops 릴리스 PR). App ID · Installation ID 는 App 설정 화면, 개인 키는 레포 밖 파일에서 넘긴다 (Terraform README 5절) ──

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
