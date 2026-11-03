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

# ── 다른 스택 output (terragrunt.hcl) ──

variable "domain_name" {
  description = "10-global 서비스 루트 도메인"
  type        = string
}

variable "zone_id" {
  description = "10-global Hosted Zone ID"
  type        = string
}

variable "certificate_arn" {
  description = "10-global 루트 + 와일드카드 ACM 인증서 ARN"
  type        = string
}

variable "app_subnet_ids" {
  description = "20-network 결제 VPC app 서브넷 (SQS 인터페이스 엔드포인트와 같은 서브넷)"
  type        = list(string)
}

variable "sg_ids" {
  description = "30-security 의 sg_ids (payment_lambda 를 쓴다)"
  type        = map(string)
}

# ── 웹훅 큐 ──

variable "webhook_queue_name" {
  description = "웹훅 표준 큐 이름. 큐 URL 이 재생성 후에도 같도록 고정 (PAYMENT_WEBHOOK_QUEUE_URL)"
  type        = string
  default     = "payment-webhook"
}

variable "webhook_dlq_name" {
  description = "처리 실패 메시지가 옮겨지는 DLQ 이름"
  type        = string
  default     = "payment-webhook-dlq"
}

variable "webhook_visibility_timeout" {
  description = "가시성 타임아웃(초). payment-service 가 한 번에 받은 메시지를 inbox 에 기록하고 지우는 시간보다 길어야 한다"
  type        = number
  default     = 30
}

variable "webhook_max_receive_count" {
  description = "이 횟수만큼 받고도 지워지지 않은 메시지는 DLQ 로 옮긴다"
  type        = number
  default     = 5
}

variable "payment_app_role_name" {
  description = "웹훅을 받는(receive · delete) 결제 앱 EC2 Role 이름 (60-payment-app)"
  type        = string
  default     = "team04-hotel-payment-app"
}

# ── Lambda ──

variable "lambda_timeout" {
  description = "Lambda 제한 시간(초). 토스가 10초 안에 200 응답을 기다리므로 그보다 짧아야 한다"
  type        = number
  default     = 8
}

variable "lambda_memory_size" {
  description = "Lambda 메모리(MB). 큐로 전달만 하므로 작게 둔다"
  type        = number
  default     = 256
}

variable "log_retention_days" {
  description = "Lambda 로그 보존 기간(일)"
  type        = number
  default     = 14
}

# ── API Gateway ──

variable "webhook_subdomain" {
  description = "웹훅 수신 서브도메인 (<이름>.<도메인>). 토스 개발자센터에 등록하는 주소"
  type        = string
  default     = "pay-webhook"
}

variable "throttling_rate_limit" {
  description = "초당 요청 한도. 넘으면 429 이고 토스가 재전송한다"
  type        = number
  default     = 20
}

variable "throttling_burst_limit" {
  description = "순간 요청 한도"
  type        = number
  default     = 40
}
