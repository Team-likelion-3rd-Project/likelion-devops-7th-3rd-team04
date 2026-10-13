# 서비스별 ECR 리포지토리와 배포할 이미지 태그(Parameter Store).
# CI 가 이미지를 push 한 뒤 Parameter Store 의 태그를 갱신하고, 배포 쪽은 이 값을 읽는다.

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

# 값은 CI 가 갱신하므로 Terraform 은 처음 만들 때만 넣고 이후 변경은 무시한다
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
