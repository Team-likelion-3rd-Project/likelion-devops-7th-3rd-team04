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
  description = "20-network 의 main.vpc_id"
  type        = string
}

variable "worker_subnet_ids" {
  description = "20-network 의 main.subnet_ids.worker (엔드포인트 ENI 를 둘 서브넷, AZ a · b — 결제 NLB 와 같은 AZ)"
  type        = list(string)
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). main_privatelink 를 쓴다"
  type        = map(string)
}

variable "endpoint_service_name" {
  description = "60-payment-app 의 endpoint_service_name"
  type        = string
}

variable "grpc_port" {
  description = "60-payment-app 의 grpc_port"
  type        = number
}

# ── 고정 이름 ──

variable "internal_zone_name" {
  description = "메인 VPC private hosted zone 이름. 바꾸면 gitops backend values 의 PAYMENT_SERVICE_HOST 도 바꾼다"
  type        = string
  default     = "team04-hotel.internal"
}

variable "payment_record_name" {
  description = "결제 gRPC 레코드 이름 (<이름>.<internal_zone_name>)"
  type        = string
  default     = "payment"
}
