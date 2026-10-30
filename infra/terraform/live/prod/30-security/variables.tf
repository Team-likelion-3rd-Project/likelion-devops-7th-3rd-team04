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

variable "main_vpc_id" {
  description = "20-network Main VPC ID"
  type        = string
}

variable "payment_vpc_id" {
  description = "20-network 의 payment.vpc_id"
  type        = string
}

variable "enable_control_plane" {
  description = "kubeadm 컨트롤 플레인 SG(main-cp, main-internal-nlb) 와 관련 규칙 생성 여부. 20-network 의 enable_control_plane_subnets 와 짝, EKS 전환 후 false"
  type        = bool
  default     = true
}

# ── 결제 서버 포트 (60-payment-app · 61-payment-mock 과 같은 값) ──

variable "payment_grpc_port" {
  description = "payment-service gRPC 포트 (메인 → PrivateLink → 결제 NLB → 결제 앱)"
  type        = number
  default     = 3004
}

variable "payment_health_port" {
  description = "payment-service 헬스체크 HTTP 포트 (GET /health, 결제 NLB Target Group 헬스체크)"
  type        = number
  default     = 3104
}

variable "payment_mock_port" {
  description = "pg-mock-service HTTP 포트 (PG_MOCK_SERVICE_URL)"
  type        = number
  default     = 3007
}
