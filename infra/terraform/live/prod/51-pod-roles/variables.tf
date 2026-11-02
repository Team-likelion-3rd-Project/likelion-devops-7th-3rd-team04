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

# ── 신뢰 정책 ──

variable "enable_pod_identity" {
  description = "Role 신뢰 정책에 EKS Pod Identity(pods.eks.amazonaws.com, var.eks_cluster_name 클러스터)를 추가할지 여부. 72-main-cluster-eks 를 올리기 전에 true"
  type        = bool
  default     = false
}

variable "eks_cluster_name" {
  description = "72-main-cluster-eks 클러스터 이름. Pod Identity 신뢰 정책의 aws:SourceArn 을 이 이름으로 만든다 (72 와 같아야 함)"
  type        = string
  default     = "team04-hotel-main-eks"
}

# ── 다른 스택 output (terragrunt.hcl 의 dependency 가 넣는다) ──

variable "oidc_issuer_url" {
  description = "10-global 의 oidc_issuer_url (70 kube-apiserver --service-account-issuer, IRSA 신뢰 정책의 OIDC 공급자)"
  type        = string
}

variable "secret_names" {
  description = "41-main-data 의 secret_names (main_db, main_valkey, backend_app, main_db_exporter). ESO Role 이 읽을 수 있는 Secret"
  type        = map(string)
}

variable "seed_admin_secret_name" {
  description = "12-secrets 🔒 의 시드 관리자 계정 Secret 이름. ESO Role 이 읽는다 (12 는 run --all 대상이 아니라 dependency 대신 고정 이름)"
  type        = string
  default     = "team04-hotel/prod/seed-admin"
}

variable "grafana_admin_secret_name" {
  description = "12-secrets 🔒 의 Grafana admin 계정 Secret 이름. ESO Role 이 읽는다 (gitops monitoring 앱 ExternalSecret)"
  type        = string
  default     = "team04-hotel/prod/grafana-admin"
}

variable "queue_names" {
  description = "43-messaging 의 queue_names (payment_result, payment_result_dlq). booking-service Role 이 받는 큐"
  type        = map(string)
}

variable "dynamodb_table_names" {
  description = "41-main-data 의 dynamodb_table_names (chat_sessions, chat_messages). chat-bot-service Role 이 읽고 쓴다"
  type        = map(string)
}

variable "vector_bucket_name" {
  description = "15-chatbot-vectors 의 vector_bucket_name output. llm-service(조회) · llm-ingest(쓰기) Role 대상"
  type        = string
}

variable "vector_index_name" {
  description = "15-chatbot-vectors 의 vector_index_name output"
  type        = string
}

variable "image_bucket_name" {
  description = "13-frontend 의 image_bucket_name output. hotel-service Role 이 객실 사진을 올리고 지운다"
  type        = string
}

variable "deploy_topic_name" {
  description = "10-global 의 deploy_topic_name. ArgoCD 배포 결과 알림(deploy-notify) Role 이 발행한다"
  type        = string
}

variable "alerts_topic_name" {
  description = "10-global 의 alerts_topic_name. Alertmanager Role 이 발행한다"
  type        = string
}

variable "notifications_kms_key_id" {
  description = "10-global 의 notifications_kms_key_id (배포 · 알림 토픽 암호화 키)"
  type        = string
}

variable "payment_metrics_workspace_id" {
  description = "10-global 의 payment_metrics_workspace_id (결제 지표 AMP). Grafana Role 이 이 워크스페이스만 조회한다"
  type        = string
}

variable "log_bucket_name" {
  description = "10-global 의 log_bucket_name output. Fluent Bit Role 이 app-logs/main-cluster/ 에 쓴다"
  type        = string
}

variable "cluster_log_group_names" {
  description = "21-observability-base 의 cluster_log_group_names (네임스페이스 → 로그 그룹). Fluent Bit Role 이 이 그룹에만 쓴다"
  type        = map(string)
}
