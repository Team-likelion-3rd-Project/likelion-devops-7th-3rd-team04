# 프론트엔드 · 객실 사진 배포 (🔒 상시 유지).
#
#   https://<도메인>/*              → CloudFront Function(버전 경로 변환) → 사이트 버킷 releases/<버전>/...
#   https://<도메인>/room-types/*   → 객실 사진 버킷 room-types/...  (hotel-service 가 고정 URL 로 내려줌)
#   https://www.<도메인>/*          → CloudFront Function 이 루트로 301 (api-gateway CORS 출처가 루트 하나라서)
#
# 릴리스 (승인 전에는 운영에 노출되지 않음)
#   1) 모노레포 main 의 GitHub Actions(release.yml) 가 빌드를 releases/<main SHA>/ 에 업로드 — 릴리스 Role 은 업로드만 (10-global)
#   2) gitops 릴리스 PR 의 envs/prod/frontend/values.yaml version = <main SHA>
#   3) merge 후 gitops GitHub Actions 가 KeyValueStore 의 version 을 바꾼다 — Actions 는 전환만 (release.tf)
#   롤백 = gitops revert PR → version 이 이전 SHA 로 돌아감. 버전마다 경로가 달라 재업로드 · 무효화가 필요 없다
#
# 10-global 은 같은 1x 단계라 dependency 대신 도메인 이름으로 Zone · 인증서를 조회한다.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# 이 스택을 apply 하는 주체 (버킷 정책에서 관리자로 허용, 11-registry 와 같은 방식)
data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

data "aws_route53_zone" "main" {
  name         = var.domain_name
  private_zone = false
}

# 10-global 의 루트 + 와일드카드 인증서 (www 포함)
data "aws_acm_certificate" "main" {
  domain      = var.domain_name
  statuses    = ["ISSUED"]
  most_recent = true
}

locals {
  name       = "${var.project}-${var.environment}-frontend"
  www_domain = "www.${var.domain_name}"

  role_arn_prefix = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role"

  # 릴리스 경로 · 객실 사진 경로 (hotel-service room-image.storage.ts 의 objectKeyPrefix)
  release_prefix = "releases"
  image_prefix   = "room-types"
  # 모노레포 release.yml dry-run 업로드 경로 (10-global 릴리스 Role 의 PutObject 범위와 같게)
  dryrun_prefix = "dryrun"
}
