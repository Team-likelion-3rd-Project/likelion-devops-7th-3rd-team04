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

variable "state_bucket" {
  description = "다른 스택 state 를 읽을 버킷 (backend.hcl 의 bucket 과 같아야 한다)"
  type        = string
  default     = "team04-hotel-tfstate"
}

variable "api_subdomain" {
  description = "ALB 에 연결할 서브도메인. 10-global 에 Zone 이 있을 때만 <api_subdomain>.<도메인> 레코드를 만든다"
  type        = string
  default     = "api"
}

variable "waf_rate_limit" {
  description = "WAF rate limit: 평가 기간(waf_rate_limit_window_sec) 동안 IP 하나가 보낼 수 있는 최대 요청 수. 넘으면 403"
  type        = number
  default     = 300

  validation {
    condition     = var.waf_rate_limit >= 10
    error_message = "waf_rate_limit 은 10 이상이어야 합니다 (WAF 최소값)."
  }
}

variable "waf_rate_limit_window_sec" {
  description = "WAF rate limit 평가 기간(초)"
  type        = number
  default     = 60

  validation {
    condition     = contains([60, 120, 300, 600], var.waf_rate_limit_window_sec)
    error_message = "waf_rate_limit_window_sec 는 60, 120, 300, 600 중 하나여야 합니다."
  }
}

variable "waf_large_body_path_regex" {
  description = "WAF 본문 크기 제한(8KB)에서 뺄 URI 경로 정규식. 기본값은 객실 등록 · 수정 API (Base64 이미지 본문)"
  type        = string
  default     = "^/api/hotels/[^/]+/rooms(/[^/]+)?$"
}
