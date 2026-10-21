# 서비스별 ECR 리포지토리와 결제 서버가 읽는 이미지 태그(Parameter Store).
# 이미지 태그의 원본은 gitops 레포(envs/prod)다. gitops merge 후 GitHub Actions 가 결제 서버용 태그를
# Parameter Store 에 갱신하고, 결제 서버 pull agent 가 이 값을 읽는다. 메인 클러스터는 gitops 레포 값을 직접 쓴다.

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

# 이미지 push 는 Runner Role 과 관리자(이 스택을 apply 하는 주체)만 허용한다.
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
        "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${var.ci_runner_role_name}",
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
