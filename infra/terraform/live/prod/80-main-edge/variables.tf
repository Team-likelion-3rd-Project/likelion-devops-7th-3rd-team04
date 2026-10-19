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

# ── 다른 스택 output (terragrunt.hcl 의 dependency 가 넣는다) ──

variable "log_bucket_name" {
  description = "10-global 장기 로그 버킷 이름 (ALB 액세스 로그 대상)"
  type        = string
}

variable "domain_name" {
  description = "10-global 서비스 루트 도메인 (도메인 구매 전 null)"
  type        = string
  default     = null
}

variable "zone_id" {
  description = "10-global Hosted Zone ID (도메인 구매 전 null)"
  type        = string
  default     = null
}

variable "certificate_arn" {
  description = "10-global ACM 인증서 ARN (인증서 생성 전 null)"
  type        = string
  default     = null
}

variable "main_network" {
  description = "20-network 의 main output (vpc_id, vpc_cidr, subnet_ids, subnet_ids_by_az)"
  type = object({
    vpc_id           = string
    vpc_cidr         = string
    subnet_ids       = map(list(string))
    subnet_ids_by_az = map(map(string))
  })
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID)"
  type        = map(string)
}

variable "worker_asg_name" {
  description = "70-main-cluster-kubeadm 워커 ASG 이름 (ALB Target Group 연결)"
  type        = string
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
