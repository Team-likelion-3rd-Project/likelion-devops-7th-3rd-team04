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

variable "vpc_id" {
  description = "20-network 의 payment.vpc_id"
  type        = string
}

variable "app_subnet_ids" {
  description = "20-network 의 payment.subnet_ids.app (엔드포인트 ENI 를 둘 서브넷, AZ 2개)"
  type        = list(string)
}

variable "s3_gateway_endpoint_id" {
  description = "20-network 의 payment.gateway_endpoint_ids.s3 (정책을 붙일 S3 게이트웨이 엔드포인트)"
  type        = string
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). payment_vpce 를 쓴다"
  type        = map(string)
}

# ── 엔드포인트 ──

variable "interface_endpoints" {
  description = <<-EOT
    인터페이스 엔드포인트 서비스 (com.amazonaws.<리전>.<이름>). 서비스 1개당 AZ 수만큼 시간 · 처리량 과금된다.
      ecr.api · ecr.dkr               이미지 pull (레이어는 S3 게이트웨이 엔드포인트)
      ssm · ssmmessages · ec2messages Session Manager, Parameter Store, Run Command
      sqs                             결제 결과 발행
      secretsmanager                  결제 DB 접속 정보 · 토스 시크릿 키
      logs                            CloudWatch Logs
  EOT
  type        = set(string)
  default = [
    "ecr.api",
    "ecr.dkr",
    "ssm",
    "ssmmessages",
    "ec2messages",
    "sqs",
    "secretsmanager",
    "logs",
  ]
}
