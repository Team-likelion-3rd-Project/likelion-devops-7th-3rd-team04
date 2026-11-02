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

variable "bucket_name" {
  description = "온프레미스 백업 버킷 이름. 공개 저장소라 account ID 를 넣지 않는다. ansible roles/etcd_backup 의 etcd_backup_bucket 과 같아야 한다"
  type        = string
  default     = "team04-hotel-onprem-backup"
}

variable "backup_prefix" {
  description = "백업 user 가 쓸 수 있는 최상위 경로. ansible etcd_backup_prefix 의 첫 구간과 같아야 한다"
  type        = string
  default     = "etcd"
}

variable "retention_days" {
  description = "백업 객체 보존 기간(일). 지나면 noncurrent 로 바뀐다"
  type        = number
  default     = 30
}

variable "noncurrent_retention_days" {
  description = "덮어쓰거나 만료된 이전 버전을 남겨 두는 기간(일)"
  type        = number
  default     = 7
}

variable "admin_role_names" {
  description = "백업 user 외에 버킷에 쓰기 · 삭제할 수 있는 IAM Role 이름 (예: 수동 정리용 관리자 SSO Role). apply 주체(issuer)는 자동으로 허용된다"
  type        = list(string)
  default     = []
}
