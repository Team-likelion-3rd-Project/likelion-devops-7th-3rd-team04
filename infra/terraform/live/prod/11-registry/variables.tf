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

variable "services" {
  description = "ECR 리포지토리를 만들 서비스 목록 (backend/apps 디렉터리 이름)"
  type        = set(string)
  default = [
    "api-gateway",
    "auth-service",
    "booking-service",
    "chat-bot-service",
    "hotel-service",
    "payment-service",
    "pg-mock-service",
    "user-service",
  ]
}

variable "image_keep_count" {
  description = "리포지토리마다 남겨 둘 최근 이미지 개수"
  type        = number
  default     = 10
}
