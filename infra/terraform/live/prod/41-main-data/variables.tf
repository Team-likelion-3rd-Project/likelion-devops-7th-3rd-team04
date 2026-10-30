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

variable "db_subnet_ids" {
  description = "20-network 의 main.subnet_ids.db (DB 계층 서브넷, AZ 2개)"
  type        = list(string)
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). main_db, main_valkey 를 쓴다"
  type        = map(string)
}

# ── 비밀값 ──

variable "credentials_version" {
  description = "DB 비밀번호 · Valkey AUTH 토큰 · Secret 값을 다시 만들 때 올리는 번호. write-only 값은 생성 시와 이 값이 바뀔 때만 전달된다"
  type        = number
  default     = 1
}

variable "external_secrets_role_name" {
  description = "Secret 값을 읽는 External Secrets Operator IRSA Role 이름 (Role 은 IRSA 이슈에서 생성)"
  type        = string
  default     = "team04-hotel-external-secrets"
}

# ── RDS MariaDB ──

variable "db_engine_version" {
  description = "MariaDB 엔진 버전 (major.minor 만 지정하면 마이너 버전은 RDS 기본값 · 자동 업그레이드)"
  type        = string
  default     = "11.8"
}

variable "db_instance_class" {
  description = "RDS 인스턴스 클래스"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "RDS 스토리지 크기(GiB, gp3)"
  type        = number
  default     = 20
}

variable "db_multi_az" {
  description = "RDS Multi-AZ 대기 인스턴스. true 면 비용 2배, 생성 시간 증가"
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "자동 백업 보관 일수. 매일 재생성하므로 기본 0(백업 끔, 생성 시간 단축). 상시 운영 시 7 이상"
  type        = number
  default     = 0
}

variable "db_name" {
  description = "처음 만들 데이터베이스 이름. user · auth · hotel · booking 서비스가 같이 쓴다 (backend/migrations)"
  type        = string
  default     = "hotel_service"
}

variable "db_master_username" {
  description = "RDS master 계정 이름. 배포 전에는 앱 · Flyway 가 이 계정을 쓴다"
  type        = string
  default     = "hotel_admin"
}

variable "db_require_secure_transport" {
  description = "MariaDB require_secure_transport. true 면 TLS 가 아닌 접속을 거부한다 (앱 · Flyway 가 TLS 로 접속해야 함). 떠 있는 인스턴스에서 바꾸면 재부팅 후 반영"
  type        = bool
  default     = true
}

variable "db_slow_query_seconds" {
  description = "슬로우 쿼리 로그 기준(초, log_slow_query_time). 이보다 오래 걸린 쿼리를 CloudWatch Logs slowquery 로 남긴다"
  type        = number
  default     = 1
}

variable "db_log_retention_days" {
  description = "RDS 에러 · 슬로우 쿼리 로그 그룹 보관 기간(일)"
  type        = number
  default     = 7
}

variable "db_exporter_username" {
  description = "mysqld_exporter 계정 이름. gitops mysql-exporter-setup Job 이 이 이름으로 만든다"
  type        = string
  default     = "exporter"
}

# ── ElastiCache Valkey ──

variable "valkey_engine_version" {
  description = "Valkey 엔진 버전"
  type        = string
  default     = "8.2"
}

variable "valkey_node_type" {
  description = "ElastiCache 노드 타입"
  type        = string
  default     = "cache.t4g.micro"
}

variable "valkey_num_nodes" {
  description = "노드 수 (primary 1 + replica). 2 이상이면 자동 장애 조치 · Multi-AZ 를 켠다"
  type        = number
  default     = 1

  validation {
    condition     = var.valkey_num_nodes >= 1 && var.valkey_num_nodes <= 6
    error_message = "valkey_num_nodes 는 1 – 6 이어야 합니다."
  }
}
