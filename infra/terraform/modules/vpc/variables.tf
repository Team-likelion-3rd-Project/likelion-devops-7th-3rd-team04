variable "name" {
  description = "리소스 Name 태그 접두사 (예: team04-hotel-main)"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR"
  type        = string
}

variable "subnets" {
  description = <<-EOT
    계층(tier) 이름 → 서브넷 설정.
      cidrs  : AZ 접미사(a, b, c) → CIDR
      public : true 면 IGW 로 나가는 public 계층 (VPC 당 최대 1개, NAT 가 여기에 놓인다)
      nat    : private 계층의 NAT 경유 여부. false 면 VPC 내부 + 게이트웨이 엔드포인트만 가능 (DB 계층)
      tags   : 계층 서브넷에 추가할 태그 (EKS 전환 시 kubernetes.io/role/elb 등)
  EOT
  type = map(object({
    cidrs  = map(string)
    public = optional(bool, false)
    nat    = optional(bool, true)
    tags   = optional(map(string), {})
  }))

  validation {
    condition     = length([for s in values(var.subnets) : s if s.public]) <= 1
    error_message = "public 계층은 VPC 당 하나만 둘 수 있습니다."
  }

  validation {
    condition = (
      length([for s in values(var.subnets) : s if s.public]) == 1 ||
      alltrue([for s in values(var.subnets) : !s.nat])
    )
    error_message = "NAT 를 경유하는 private 계층이 있으면 NAT 를 둘 public 계층이 필요합니다."
  }
}

variable "single_nat_gateway" {
  description = "true 면 NAT 를 VPC 당 1개(첫 번째 public AZ)만 만든다. false 면 public 서브넷 AZ 마다 1개"
  type        = bool
  default     = false
}

variable "gateway_endpoints" {
  description = "모든 라우트 테이블에 연결할 게이트웨이 엔드포인트 서비스 (s3, dynamodb)"
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for s in var.gateway_endpoints : contains(["s3", "dynamodb"], s)])
    error_message = "게이트웨이 엔드포인트는 s3, dynamodb 만 지원합니다."
  }
}

variable "flow_log_destination_arn" {
  description = "VPC Flow Logs 를 보낼 S3 ARN (버킷 ARN/prefix/). null 이면 Flow Logs 를 만들지 않는다"
  type        = string
  default     = null
}
