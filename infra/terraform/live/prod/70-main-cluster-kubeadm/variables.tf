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

variable "oidc_issuer_url" {
  description = "10-global 의 oidc_issuer_url (kube-apiserver --service-account-issuer, IRSA 신뢰 정책의 OIDC 공급자)"
  type        = string
}

variable "oidc_bucket_name" {
  description = "10-global 의 oidc_bucket_name (CP-a 가 init 후 keys.json 을 올리는 버킷)"
  type        = string
}

variable "secret_names" {
  description = "41-main-data 의 secret_names (main_db, main_valkey, backend_app). ESO Role 이 읽을 수 있는 Secret"
  type        = map(string)
}

variable "seed_admin_secret_name" {
  description = "12-secrets 🔒 의 시드 관리자 계정 Secret 이름. ESO Role 이 읽는다 (12 는 run --all 대상이 아니라 dependency 대신 고정 이름)"
  type        = string
  default     = "team04-hotel/prod/seed-admin"
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

variable "notifications_kms_key_id" {
  description = "10-global 의 notifications_kms_key_id (배포 토픽 암호화 키)"
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

variable "main_network" {
  description = "20-network 의 main output (vpc_id, vpc_cidr, subnet_ids, subnet_ids_by_az)"
  type = object({
    vpc_id           = string
    vpc_cidr         = string
    subnet_ids       = map(list(string))
    subnet_ids_by_az = map(map(string))
  })
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID)"
  type        = map(string)
}

variable "control_plane_instance_type" {
  description = "컨트롤 플레인 인스턴스 타입 (x86_64). kubeadm 최소 요건 2 vCPU · 2GB"
  type        = string
  default     = "t3a.medium"
}

variable "worker_instance_type" {
  description = "워커 인스턴스 타입 (x86_64)"
  type        = string
  default     = "t3a.large"
}

variable "worker_desired_capacity" {
  description = "워커 ASG 희망 대수"
  type        = number
  default     = 2
}

variable "worker_min_size" {
  description = "워커 ASG 최소 대수"
  type        = number
  default     = 2
}

variable "worker_max_size" {
  description = "워커 ASG 최대 대수"
  type        = number
  default     = 4
}

variable "root_volume_size" {
  description = "노드(CP · 워커) 루트 볼륨 크기 (GiB, gp3)"
  type        = number
  default     = 30
}

variable "ansible_core_version" {
  description = "노드 user-data 가 pip 로 설치할 ansible-core 마이너 버전. Ubuntu 22.04 python 3.10 은 2.17 까지 지원"
  type        = string
  default     = "2.17"
}
