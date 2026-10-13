# 장기 로그 버킷. 경로(prefix)로 로그 종류를 나눈다.
#   app-logs/       Fluent Bit (메인 클러스터 · 결제 EC2) — IAM Role 로 쓰므로 버킷 정책 불필요
#                   Object Lock 버킷이라 Fluent Bit s3 output 에 send_content_md5 true 필요
#   vpc-flow-logs/  VPC Flow Logs (20-network)
#   alb/            ALB 액세스 로그 (80-main-edge)
#
# 버킷 정책은 버킷당 하나라 여러 스택이 나눠 가질 수 없으므로, 로그 전달 서비스 권한을 여기서 미리 열어 둔다.
# Object Lock 은 버킷 생성 시에만 켤 수 있고, 잠긴 객체가 남아 있으면 버킷을 지울 수 없다.
# GOVERNANCE 모드: 일반 사용자는 삭제 불가, s3:BypassGovernanceRetention 권한이 있으면 정리 가능.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_elb_service_account" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
}

resource "aws_s3_bucket" "logs" {
  bucket              = var.log_bucket_name
  object_lock_enabled = true

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "logs" {
  bucket = aws_s3_bucket.logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Object Lock 버킷은 버저닝이 항상 켜져 있어야 한다
resource "aws_s3_bucket_versioning" "logs" {
  bucket = aws_s3_bucket.logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

# ALB 액세스 로그는 SSE-S3 만 지원하므로 KMS 를 쓰지 않는다
resource "aws_s3_bucket_server_side_encryption_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_object_lock_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = var.log_object_lock_days
    }
  }

  depends_on = [aws_s3_bucket_versioning.logs]
}

# 잠금이 풀린 뒤 보관 기간이 지나면 삭제한다 (잠긴 객체는 lifecycle 로도 지워지지 않는다)
resource "aws_s3_bucket_lifecycle_configuration" "logs" {
  bucket = aws_s3_bucket.logs.id

  rule {
    id     = "expire-logs"
    status = "Enabled"

    filter {}

    expiration {
      days = var.log_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.logs]
}

data "aws_iam_policy_document" "logs" {
  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.logs.arn,
      "${aws_s3_bucket.logs.arn}/*",
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

  # VPC Flow Logs → vpc-flow-logs/
  statement {
    sid       = "FlowLogsAclCheck"
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.logs.arn]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${var.region}:${local.account_id}:*"]
    }
  }

  statement {
    sid       = "FlowLogsWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/vpc-flow-logs/AWSLogs/${local.account_id}/*"]

    principals {
      type        = "Service"
      identifiers = ["delivery.logs.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${data.aws_partition.current.partition}:logs:${var.region}:${local.account_id}:*"]
    }
  }

  # ALB 액세스 로그 → alb/ (us-east-1 은 리전별 ELB 계정이 쓴다)
  statement {
    sid       = "AlbLogsWrite"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.logs.arn}/alb/AWSLogs/${local.account_id}/*"]

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.current.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "logs" {
  bucket = aws_s3_bucket.logs.id
  policy = data.aws_iam_policy_document.logs.json

  depends_on = [aws_s3_bucket_public_access_block.logs]
}
