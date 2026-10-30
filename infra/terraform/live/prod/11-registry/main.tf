# 서비스별 ECR 리포지토리와 결제 서버가 읽는 배포 release(Parameter Store).
# 이미지 태그의 원본은 gitops 레포(envs/prod)다. gitops merge 후 GitHub Actions 가 결제 서버용 release 를
# Parameter Store 에 갱신하고, 결제 서버 · pg-mock pull agent 가 이 값을 읽는다. 메인 클러스터는 gitops 레포 값을 직접 쓴다.

resource "aws_ecr_repository" "service" {
  for_each = var.services

  name = "${var.project}/${each.key}"
  # 같은 태그로 다른 이미지를 덮어쓰지 못하게 한다 (태그 = 커밋 SHA)
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecr_lifecycle_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name

  # tagStatus = any 규칙은 우선순위가 가장 낮아야 한다 (rulePriority 가 가장 큼)
  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "태그 없는 이미지는 1일 뒤 삭제"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "최근 ${var.image_keep_count}개만 보관"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.image_keep_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

# 결제 서버 release: gitops envs/prod/payment/values.yaml 의 image.imageTag 와 env(비밀 아닌 설정)를 JSON 하나로 둔다.
# 태그와 설정이 한 번에 바뀌므로 agent 가 새 설정 + 이전 태그 같은 중간 상태로 배포하지 않는다.
# 쓰는 주체는 gitops main 의 GitHub Actions(10-global gitops_ssm_sync Role) 하나다. 결제 서버 · pg-mock 은 읽기만 한다.
# 값은 gitops merge 후 갱신되므로 Terraform 은 처음 만들 때만 넣고(image_tag = none → agent 는 배포하지 않음) 이후 변경은 무시한다.
# 이 스택은 destroy 하지 않으므로 매일 재생성 후에도 마지막 release 가 남는다
resource "aws_ssm_parameter" "payment_release" {
  name        = "/${var.project}/${var.environment}/payment/release"
  description = "Payment server release {image_tag, env} synced from gitops"
  type        = "String"
  value       = jsonencode({ image_tag = "none", env = {} })

  lifecycle {
    ignore_changes = [value]
  }
}

# 서비스별 이미지 태그. 결제 서버는 위 release 를 쓴다 (이 파라미터는 지금 읽는 곳이 없다)
# 값은 gitops merge 후 GitHub Actions 가 갱신하므로 Terraform 은 처음 만들 때만 넣고 이후 변경은 무시한다
resource "aws_ssm_parameter" "image_tag" {
  for_each = var.services

  name        = "/${var.project}/${var.environment}/image-tag/${each.key}"
  description = "${each.key} 배포 이미지 태그"
  type        = "String"
  value       = "none"

  lifecycle {
    ignore_changes = [value]
  }
}

# release.yml dry-run 의 복사 대상 (태그 <서비스>-<main SHA>). 실제 릴리스와 같은 Role · 같은 복사로 권한과 digest 를 미리 확인한다.
# 배포되지 않고 다시 실행하면 같은 태그를 덮어쓰므로 MUTABLE, 스캔 없음, 1일 뒤 모두 삭제
resource "aws_ecr_repository" "release_dryrun" {
  name                 = "${var.project}/release-dryrun"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_lifecycle_policy" "release_dryrun" {
  repository = aws_ecr_repository.release_dryrun.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "dry-run 이미지는 1일 뒤 삭제"
        selection = {
          tagStatus   = "any"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
    ]
  })
}

# 이미지 push 는 릴리스 Role(10-global, release.yml) 과 관리자(이 스택을 apply 하는 주체)만 허용한다.
# 공유 계정이라 넓은 ECR 권한을 가진 다른 주체가 같은 태그를 먼저 올리면(IMMUTABLE 이라 먼저 올린 쪽이 남음)
# 검증되지 않은 이미지가 배포될 수 있다. IAM 정책으로 권한을 받은 주체도 저장소 정책의 Deny 가 우선한다.
# pull 은 제한하지 않는다 (노드 · 결제 서버 Role 의 IAM 정책이 저장소 범위를 정함)
data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

data "aws_iam_policy_document" "push_only_ci" {
  statement {
    sid    = "DenyPushExceptCiAndAdmin"
    effect = "Deny"
    actions = [
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values = [
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.release_role_name}",
        data.aws_iam_session_context.current.issuer_arn,
      ]
    }
  }
}

resource "aws_ecr_repository_policy" "service" {
  for_each = aws_ecr_repository.service

  repository = each.value.name
  policy     = data.aws_iam_policy_document.push_only_ci.json
}

resource "aws_ecr_repository_policy" "release_dryrun" {
  repository = aws_ecr_repository.release_dryrun.name
  policy     = data.aws_iam_policy_document.push_only_ci.json
}

# 외부 이미지 미러 (LDP-181). 결제 VPC 는 Docker Hub 에 갈 수 없어(NFW 허용 목록은 토스만) 결제 서버 수집기 이미지를 여기서 받는다.
# 버전을 올릴 때 apply 주체가 한 번 복사한다 (README 결제 서버 지표 절, amd64 단일 아키텍처).
# 60-payment-app 은 data "aws_ecr_image" 로 digest 를 읽으므로 미러가 없으면 plan 에서 실패한다.
# 태그 = 원본 버전, 같은 버전을 다른 이미지로 덮어쓰지 못하게 IMMUTABLE
resource "aws_ecr_repository" "mirror" {
  for_each = var.mirror_images

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_ecr_lifecycle_policy" "mirror" {
  for_each = aws_ecr_repository.mirror

  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "최근 ${var.mirror_keep_count}개 버전만 보관"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = var.mirror_keep_count
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_repository_policy" "mirror" {
  for_each = aws_ecr_repository.mirror

  repository = each.value.name
  policy     = data.aws_iam_policy_document.push_only_ci.json
}
