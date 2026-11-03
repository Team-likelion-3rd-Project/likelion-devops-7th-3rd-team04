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

variable "log_bucket_name" {
  description = "10-global 장기 로그 버킷 이름 (k6 결과를 load-test/ 경로에 올린다)"
  type        = string
}

variable "public_subnet_id" {
  description = "20-network 의 main.subnet_ids.public[0] (부하 생성기가 EIP 로 ALB 에 나가는 서브넷)"
  type        = string
}

variable "sg_ids" {
  description = "30-security 의 sg_ids output (<vpc>_<역할> → SG ID). main_load_generator 를 쓴다"
  type        = map(string)
}

# ── 부하 생성기 ──

variable "enable_load_generator" {
  description = "부하 생성기 인스턴스 · EIP 생성 여부. 부하 테스트 날만 true. 켜거나 끈 뒤에는 80-main-edge 도 apply 해야 WAF 예외 주소가 바뀐다"
  type        = bool
  default     = false
}

variable "instance_type" {
  description = "부하 생성기 인스턴스 타입 (x86_64, 버스터블 제외). stress 상한(500 요청/초, VU 약 3,500)까지 생성기가 먼저 병목이 되지 않을 크기"
  type        = string
  default     = "m7a.xlarge"

  validation {
    condition     = !startswith(var.instance_type, "t")
    error_message = "버스터블(t*) 타입은 CPU 크레딧 소진으로 측정 중 생성기 성능이 바뀌므로 쓰지 않습니다."
  }
}

variable "root_volume_size" {
  description = "부하 생성기 루트 볼륨 크기 (GiB, gp3). fault 프로필 --out csv 결과가 쌓인다"
  type        = number
  default     = 30
}

variable "k6_version" {
  description = "k6 버전 (GitHub 릴리스). 로컬 검증 버전과 맞춘다. 바꾸면 k6_sha256 도 바꾼다"
  type        = string
  default     = "2.2.0"
}

variable "k6_sha256" {
  description = "k6-v<k6_version>-linux-amd64.tar.gz SHA-256 (릴리스의 k6-v<버전>-checksums.txt)"
  type        = string
  default     = "b5a8003c86f35f5cd5ceef1490312c48e587696c94d998cefc6d7b3b4cb1597d"
}

variable "repo_url" {
  description = "load-test/ 를 받을 모노레포 주소 (공개 레포, 인증 없음)"
  type        = string
  default     = "https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04.git"
}

variable "repo_ref" {
  description = "부팅 때 받을 브랜치. 테스트 중 스크립트를 바꾸면 인스턴스에서 git pull · checkout 한다"
  type        = string
  default     = "main"
}
