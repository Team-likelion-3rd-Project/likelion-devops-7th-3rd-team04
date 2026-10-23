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

variable "payment_network" {
  description = "20-network 의 payment output (vpc_id, subnet_ids, subnet_ids_by_az, app_static_cidr). lb · app 서브넷, 배포 AZ 순서, pg-mock 고정 IP 대역을 쓴다"
  type = object({
    vpc_id           = string
    subnet_ids       = map(list(string))
    subnet_ids_by_az = map(map(string))
    app_static_cidr  = string
  })
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). payment_app, payment_nlb 를 쓴다"
  type        = map(string)
}

variable "payment_db_secret_name" {
  description = "42-payment-data 의 secret_name (결제 DB 접속 정보 Secret)"
  type        = string
}

variable "queue_names" {
  description = "43-messaging 의 queue_names. payment_result 큐에 결과를 보낸다"
  type        = map(string)
}

# ── 결제 서버 ──

variable "payment_app_role_name" {
  description = "결제 서버 Role · Instance Profile 이름. 42 Secret · 12 토스 Secret · 43 큐 정책이 이 이름을 허용한다 (바꾸면 셋 다 같이)"
  type        = string
  default     = "team04-hotel-payment-app"
}

variable "image_repositories" {
  description = "결제 서버가 pull 하는 11-registry 저장소 (<project>/<이름>). pg-mock 은 61-payment-mock"
  type        = set(string)
  default     = ["payment-service", "payment-migrations"]
}

variable "instance_type" {
  description = "결제 서버 인스턴스 타입 (arm64)"
  type        = string
  default     = "t4g.small"
}

variable "desired_capacity" {
  description = "결제 서버 ASG 희망 대수. 배포 중 무중단은 2 이상일 때만 (1대면 교체 동안 결제 중단)"
  type        = number
  default     = 2
}

variable "min_size" {
  description = "결제 서버 ASG 최소 대수. desired_capacity 보다 작아야 배포 때 Standby 로 뺄 수 있다 (같으면 Standby 없이 교체)"
  type        = number
  default     = 1
}

variable "max_size" {
  description = "결제 서버 ASG 최대 대수"
  type        = number
  default     = 2
}

variable "health_check_grace_period" {
  description = "ASG 가 새 인스턴스의 NLB 헬스체크 결과를 무시하는 시간(초). 부팅 · 첫 배포(docker 설치 · 이미지 pull · Flyway) 시간보다 길어야 한다"
  type        = number
  default     = 600
}

variable "deploy_stagger_seconds" {
  description = "pull agent 가 AZ 순번마다 늦추는 배포 시작 시간(초). 서버 1대의 배포(pull · Flyway · drain · 헬스 확인)보다 길어야 2대가 동시에 빠지지 않는다"
  type        = number
  default     = 180
}

variable "deploy_health_timeout" {
  description = "pull agent 가 새 payment-service 의 헬스 확인을 기다리는 시간(초). 넘으면 이전 release 로 되돌린다"
  type        = number
  default     = 120
}

variable "log_retention_days" {
  description = "결제 서버 CloudWatch 로그 그룹(app · deploy) 보관 기간(일)"
  type        = number
  default     = 7
}

# ── pg-mock (61-payment-mock) ──
# 61 은 60 과 같은 단계라 output 을 참조하지 않고 같은 규칙으로 주소를 만든다

variable "pg_mock_private_ip_hostnum" {
  description = "pg-mock 고정 IP 의 app_static_cidr 안 주소 번호. 61-payment-mock 의 private_ip_hostnum 과 같게"
  type        = number
  default     = 4
}

variable "pg_mock_port" {
  description = "pg-mock-service HTTP 포트. 61-payment-mock 의 mock_port 와 같게"
  type        = number
  default     = 3007
}

variable "root_volume_size" {
  description = "결제 서버 루트 볼륨 크기 (GiB, gp3). 이미지 2개(payment-service · payment-migrations) 의 이전 · 현재 버전을 담는다"
  type        = number
  default     = 20
}

variable "grpc_port" {
  description = "payment-service gRPC 포트 (NLB 리스너 · Target Group). 30-security payment_grpc_port 와 같게"
  type        = number
  default     = 3004
}

variable "health_port" {
  description = "payment-service 헬스체크 HTTP 포트 (GET /health). 30-security payment_health_port 와 같게"
  type        = number
  default     = 3104
}
