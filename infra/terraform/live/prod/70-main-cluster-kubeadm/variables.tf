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
  description = "10-global 의 oidc_issuer_url (kube-apiserver --service-account-issuer, 51-pod-roles IRSA 신뢰 정책과 같은 값)"
  type        = string
}

variable "oidc_bucket_name" {
  description = "10-global 의 oidc_bucket_name (CP-a 가 init 후 keys.json 을 올리는 버킷)"
  type        = string
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
