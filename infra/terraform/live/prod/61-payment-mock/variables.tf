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

variable "app_subnet_id" {
  description = "20-network 의 payment.subnet_ids_by_az.app.a (고정 IP 예약 대역이 있는 서브넷)"
  type        = string
}

variable "static_cidr" {
  description = "20-network 의 payment.app_static_cidr (app-a 서브넷의 자동 할당 제외 대역)"
  type        = string
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). payment_mock 을 쓴다"
  type        = map(string)
}

# ── pg-mock ──

variable "enable_pg_mock" {
  description = "pg-mock 인스턴스 생성 여부. 개발 · 부하 테스트 기간 true, 필요 없으면 false (결제 서버는 PAYMENT_PROVIDER=TOSS)"
  type        = bool
  default     = true
}

variable "private_ip_hostnum" {
  description = "static_cidr 안에서 pg-mock 이 쓸 주소 번호 (cidrhost). 바꾸면 결제 서버 PG_MOCK_SERVICE_URL 도 바뀐다"
  type        = number
  default     = 4
}

variable "instance_type" {
  description = "pg-mock 인스턴스 타입 (arm64). 부하 테스트 때 mock 이 먼저 병목이 되지 않을 크기"
  type        = string
  default     = "t4g.small"
}

variable "root_volume_size" {
  description = "pg-mock 루트 볼륨 크기 (GiB, gp3)"
  type        = number
  default     = 20
}

variable "mock_port" {
  description = "pg-mock-service HTTP 포트. 30-security payment_mock_port 와 같게"
  type        = number
  default     = 3007
}
