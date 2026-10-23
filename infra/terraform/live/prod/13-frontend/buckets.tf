# 사이트 버킷 · 객실 사진 버킷. 둘 다 비공개이고 CloudFront(OAC) 로만 읽는다.
# 공통 설정(소유권 · 공개 차단 · 암호화)은 for_each 로, 정책 · 수명 주기 · CORS 는 버킷별로 둔다.

locals {
  buckets = {
    site  = var.site_bucket_name
    image = var.image_bucket_name
  }
}

resource "aws_s3_bucket" "this" {
  for_each = local.buckets

  bucket = each.value

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# OAC 는 SSE-KMS 를 쓰려면 키 정책에 CloudFront 를 따로 허용해야 하므로 SSE-S3 를 쓴다
resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = aws_s3_bucket.this

  bucket = each.value.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 사이트: 오래된 릴리스 정리. 릴리스는 SHA 경로라 덮어쓰지 않으므로 버전 관리는 켜지 않는다
resource "aws_s3_bucket_lifecycle_configuration" "site" {
  bucket = aws_s3_bucket.this["site"].id

  rule {
    id     = "expire-old-releases"
    status = "Enabled"

    filter {
      prefix = "${local.release_prefix}/"
    }

    expiration {
      days = var.release_retention_days
    }
  }

  rule {
    id     = "abort-incomplete-upload"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "image" {
  bucket = aws_s3_bucket.this["image"].id

  rule {
    id     = "abort-incomplete-upload"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

# 관리자 화면(루트 도메인)에서 hotel-service 가 서명한 Presigned PUT 으로 직접 올린다.
# 프론트는 Content-Type 만 보낸다 (Content-Length 는 브라우저가 붙이고 CORS 대상 헤더가 아님). www 는 루트로 리다이렉트되므로 허용하지 않는다
resource "aws_s3_bucket_cors_configuration" "image" {
  bucket = aws_s3_bucket.this["image"].id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.domain_name}"]
    allowed_headers = ["content-type"]
    expose_headers  = ["ETag"]
    max_age_seconds = 3000
  }
}

# ── 버킷 정책 ─────────────────────────────────────────────
# 읽기: 이 배포(aws:SourceArn)의 CloudFront 만, 버킷별로 정한 경로만.
# 쓰기: IAM 정책으로 권한을 받은 주체(Runner · hotel-service · 시드 Job)와 관리자만. 공유 계정이라 넓은 S3 권한을 가진
#       다른 주체가 운영 사이트 · 사진을 바꾸지 못하게 Deny 로 막는다 (IAM 정책의 Allow 보다 버킷 정책의 Deny 가 우선, 11-registry 와 같은 방식)
locals {
  bucket_access = {
    site = {
      read_prefix = local.release_prefix
      writer_arns = ["${local.role_arn_prefix}/${var.ci_runner_role_name}"]
    }
    image = {
      read_prefix = local.image_prefix
      writer_arns = [
        "${local.role_arn_prefix}/${var.image_writer_role_name}",
        "${local.role_arn_prefix}/${var.image_seed_role_name}",
      ]
    }
  }
}

data "aws_iam_policy_document" "bucket" {
  for_each = local.bucket_access

  statement {
    sid       = "CloudFrontRead"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this[each.key].arn}/${each.value.read_prefix}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceArn"
      values   = [aws_cloudfront_distribution.main.arn]
    }
  }

  statement {
    sid    = "DenyWriteExceptOwners"
    effect = "Deny"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:PutObjectTagging",
      "s3:DeleteObjectTagging",
      "s3:RestoreObject",
    ]
    resources = ["${aws_s3_bucket.this[each.key].arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values   = concat(each.value.writer_arns, [data.aws_iam_session_context.current.issuer_arn])
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.this[each.key].arn,
      "${aws_s3_bucket.this[each.key].arn}/*",
    ]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "this" {
  for_each = local.bucket_access

  bucket = aws_s3_bucket.this[each.key].id
  policy = data.aws_iam_policy_document.bucket[each.key].json

  depends_on = [aws_s3_bucket_public_access_block.this]
}
