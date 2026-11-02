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

# ── 결제 결과 큐 (온프레미스 dev ElasticMQ 와 같은 값, infra/ansible group_vars/payment.yml) ──

variable "payment_result_queue_name" {
  description = "결제 결과 FIFO 큐 이름. 큐 URL 이 재생성 후에도 같도록 고정 (PAYMENT_RESULT_QUEUE_URL)"
  type        = string
  default     = "payment-result.fifo"
}

variable "payment_result_dlq_name" {
  description = "처리 실패 메시지가 옮겨지는 DLQ 이름"
  type        = string
  default     = "payment-result-dlq.fifo"
}

variable "payment_result_visibility_timeout" {
  description = "가시성 타임아웃(초). booking-service 가 한 번에 받은 메시지(최대 10개)를 Inbox 에 반영하고 지우는 시간보다 길어야 한다"
  type        = number
  default     = 30
}

variable "payment_result_max_receive_count" {
  description = "이 횟수만큼 받고도 지워지지 않은 메시지는 DLQ 로 옮긴다"
  type        = number
  default     = 5
}

# ── 큐 정책이 허용하는 Role (고정 이름, Role 은 사용하는 쪽 스택이 만든다) ──

variable "booking_role_name" {
  description = "결제 결과를 받는(receive · delete) booking-service IRSA Role 이름 (51-pod-roles)"
  type        = string
  default     = "team04-hotel-booking-service"
}

variable "payment_app_role_name" {
  description = "결제 결과를 보내는(send) 결제 앱 EC2 Role 이름 (60-payment-app)"
  type        = string
  default     = "team04-hotel-payment-app"
}
