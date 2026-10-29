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

variable "alerts_topic_name" {
  description = "10-global 의 alerts_topic_name. 모든 알람의 ALARM · OK 알림 대상 (Slack #alerts)"
  type        = string
}

variable "queue_names" {
  description = "43-messaging 의 queue_names (payment_result_dlq 를 본다)"
  type        = map(string)
}

variable "payment_nlb_arn_suffix" {
  description = "60-payment-app 의 nlb_arn_suffix"
  type        = string
}

variable "payment_target_group_arn_suffix" {
  description = "60-payment-app 의 target_group_arn_suffix"
  type        = string
}

variable "payment_deploy_log_group_name" {
  description = "60-payment-app 의 deploy_log_group_name (pull agent 배포 이벤트 JSON)"
  type        = string
}

variable "alb_arn_suffix" {
  description = "80-main-edge 의 alb_arn_suffix"
  type        = string
}

variable "alb_target_group_arn_suffix" {
  description = "80-main-edge 의 target_group_arn_suffix (워커)"
  type        = string
}

variable "db_instance_identifiers" {
  description = "RDS 식별자 (main: 41-main-data, payment: 42-payment-data 의 db_instance_identifier). 키는 알람 이름에 들어간다"
  type        = map(string)
}

variable "valkey_member_clusters" {
  description = "41-main-data 의 valkey_member_clusters (Valkey 노드 ID, 노드별 알람)"
  type        = list(string)
}

# ── 임계값 ──

variable "alb_5xx_rate_threshold" {
  description = "ALB 5xx 비율(%) 임계값. ALB 자체(ELB) · 대상(Target) 5xx 합 / 요청 수, 1분 단위 3번 중 2번 넘으면 알람"
  type        = number
  default     = 5
}

variable "alb_5xx_min_requests" {
  description = "5xx 비율을 계산할 최소 요청 수(1분). 요청이 적을 때 1 – 2건 실패로 비율이 튀는 것을 막는다"
  type        = number
  default     = 20
}

variable "unhealthy_evaluation_minutes" {
  description = "Target Group unhealthy 가 이 시간(분) 동안 이어지면 알람. 노드 교체 · 결제 서버 부팅(약 2 – 5분)보다 길게 둔다"
  type        = number
  default     = 5
}

variable "db_cpu_surplus_threshold" {
  description = "RDS CPUSurplusCreditBalance 임계값(크레딧). 1 크레딧 = vCPU 1개 100% 1분. 부팅 때 1 – 2 는 정상"
  type        = number
  default     = 10
}

variable "db_freeable_memory_mib" {
  description = "RDS FreeableMemory 하한(MiB). db.t4g.micro(1 GiB)는 버퍼 풀 421 MiB 를 쓰고 평소 110 – 140 MiB 가 남는다 (10-29)"
  type        = number
  default     = 64
}

variable "db_free_storage_gib" {
  description = "RDS FreeStorageSpace 하한(GiB). allocated_storage 20 GiB 기준 10%"
  type        = number
  default     = 2
}

variable "db_connections_threshold" {
  description = "RDS DatabaseConnections 임계값. db.t4g.micro max_connections 30(10-29 실측), 메인 평소 22(앱 20 + rdsadmin 2)"
  type        = number
  default     = 26
}

variable "valkey_memory_percent_threshold" {
  description = "Valkey DatabaseMemoryUsagePercentage 임계값(%)"
  type        = number
  default     = 80
}

variable "valkey_connections_threshold" {
  description = "Valkey CurrConnections 임계값. 평소 10 미만 (10-29)"
  type        = number
  default     = 200
}
