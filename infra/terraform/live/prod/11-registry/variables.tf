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

variable "services" {
  description = "ECR 리포지토리를 만들 이미지 목록 (backend/apps 디렉터리 이름 + DB 마이그레이션 + 시드). .gitlab-ci.yml release:build 매트릭스와 같다"
  type        = set(string)
  default = [
    "api-gateway",
    "auth-service",
    "booking-service",
    "chat-bot-service",
    "hotel-service",
    "payment-service",
    "pg-mock-service",
    "user-service",
    # Flyway 마이그레이션 (메인: backend 차트 hook Job, 결제: 결제 서버)
    "main-migrations",
    "payment-migrations",
    # 초기 데이터 시딩 (backend 차트 seed Job, backend/scripts/Dockerfile.seed). 운영 전용 — .gitlab-ci.yml RELEASE_ONLY_IMAGES
    "seed",
    # 챗봇 (LDP-143). llm-service 는 langchain_rag/llm-service/Dockerfile 빌드(태그 = 커밋 SHA),
    # n8n 은 Docker Hub n8nio/n8n 을 release:mirror-n8n 이 옮긴 것(태그 = N8N_VERSION)
    "llm-service",
    "n8n",
  ]
}

variable "image_keep_count" {
  description = "리포지토리마다 남겨 둘 최근 이미지 개수"
  type        = number
  default     = 10
}

variable "build_cache_expire_days" {
  description = "빌드 캐시 저장소(<project>/cache)에서 캐시를 지우기까지의 일수. .gitlab-ci.yml release:build 의 --cache-ttl 과 같게"
  type        = number
  default     = 14
}

variable "ci_runner_role_name" {
  description = "이미지를 push 하는 40-cicd Runner IAM Role 이름. 저장소 정책이 이 Role 과 관리자만 push 를 허용한다"
  type        = string
  default     = "team04-hotel-ci-runner"
}
