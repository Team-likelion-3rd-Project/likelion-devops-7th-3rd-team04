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

variable "deployment_network" {
  description = "20-network 의 deployment output. subnet_ids.runner 를 쓴다"
  type = object({
    subnet_ids = map(list(string))
  })
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output. deployment_runner 를 쓴다"
  type        = map(string)
}

variable "frontend_bucket_name" {
  description = "13-frontend 의 site_bucket_name output. Runner 가 프론트 빌드를 releases/ 에 올린다"
  type        = string
}

# ── Runner ──

variable "instance_type" {
  description = "Runner 인스턴스 타입 (Graviton). 빌드한 이미지 아키텍처가 운영 워커(arm64)와 같아야 한다. 빌드가 CPU 를 계속 쓰므로 버스트(t 계열) 대신 고정 성능, 메모리는 동시 job 2개(gitlab_runner_concurrent) 기준"
  type        = string
  default     = "m7g.large"
}

variable "root_volume_size" {
  description = "루트 볼륨 크기(GiB, gp3). job 이미지 · 빌드 캐시가 쌓인다"
  type        = number
  default     = 30
}

variable "ansible_core_version" {
  description = "user-data 가 pip 로 설치할 ansible-core 마이너 버전. Ubuntu 22.04 python 3.10 은 2.17 까지 지원 (70 과 같게)"
  type        = string
  default     = "2.17"
}
