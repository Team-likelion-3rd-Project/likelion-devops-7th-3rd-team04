# 온프레미스(dev) 백업 버킷 · 업로드 전용 IAM user.
# 대상은 control plane 의 etcd snapshot + /etc/kubernetes/pki + admin.conf 뿐이다 (ansible roles/etcd_backup).
# DB 는 시딩으로 다시 만들고, 로그는 Loki 가 맡으므로 올리지 않는다. 담당자 전달 사항은 README.md

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

# assumed-role 세션 ARN 이 아니라 Role ARN(issuer) — 버킷 정책에서 apply 주체를 허용할 때 쓴다
data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  role_arn_prefix = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role"
}

# ── 버킷 ─────────────────────────────────────────────
resource "aws_s3_bucket" "backup" {
  bucket = var.bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "backup" {
  bucket = aws_s3_bucket.backup.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 객체는 업로드 전에 age 로 암호화돼 있다 (클라이언트 측). 버킷 기본 암호화는 SSE-S3
resource "aws_s3_bucket_server_side_encryption_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 업로드 user 는 삭제 권한이 없지만 덮어쓰기는 할 수 있다 → 이전 버전을 남겨 둔다
resource "aws_s3_bucket_versioning" "backup" {
  bucket = aws_s3_bucket.backup.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backup" {
  bucket = aws_s3_bucket.backup.id

  # 보존 기간이 지난 백업 → noncurrent → noncurrent_retention_days 뒤 삭제
  rule {
    id     = "expire-old-backups"
    status = "Enabled"

    filter {}

    expiration {
      days = var.retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_retention_days
    }
  }

  # expiration 에 days 와 expired_object_delete_marker 를 함께 쓸 수 없어 규칙을 나눈다
  rule {
    id     = "cleanup-delete-markers"
    status = "Enabled"

    filter {}

    expiration {
      expired_object_delete_marker = true
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }

  depends_on = [aws_s3_bucket_versioning.backup]
}

# ── 버킷 정책 ─────────────────────────────────────────────
# 쓰기 · 삭제: 백업 user, admin_role_names, apply 주체만. 공유 계정이라 넓은 S3 권한을 가진 다른 주체가
# 백업을 지우거나 바꾸지 못하게 Deny 로 막는다 (13-frontend · 11-registry 와 같은 방식). 수명 주기 삭제는 S3 가 하므로 영향 없음
data "aws_iam_policy_document" "bucket" {
  statement {
    sid    = "DenyWriteExceptOwners"
    effect = "Deny"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:PutObjectTagging",
      "s3:DeleteObjectTagging",
      "s3:RestoreObject",
    ]
    resources = ["${aws_s3_bucket.backup.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringNotEquals"
      variable = "aws:PrincipalArn"
      values = concat(
        [aws_iam_user.backup.arn, data.aws_iam_session_context.current.issuer_arn],
        [for name in var.admin_role_names : "${local.role_arn_prefix}/${name}"],
      )
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.backup.arn,
      "${aws_s3_bucket.backup.arn}/*",
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

resource "aws_s3_bucket_policy" "backup" {
  bucket = aws_s3_bucket.backup.id
  policy = data.aws_iam_policy_document.bucket.json

  depends_on = [aws_s3_bucket_public_access_block.backup]
}

# ── 업로드 전용 IAM user ─────────────────────────────────────
# 온프레미스는 OIDC · 인스턴스 Role 을 쓸 수 없어 IAM user 를 둔다.
# access key 는 Terraform 으로 만들지 않는다 (secret 이 state 에 남음) — apply 후 CLI 로 발급해 OpenBao 에 넣는다 (README.md)
resource "aws_iam_user" "backup" {
  name = "${var.project}-onprem-backup"
}

# 올리기만 한다. 읽기 · 목록 · 삭제 권한 없음 → 키가 새어도 기존 백업을 읽거나 지울 수 없다
data "aws_iam_policy_document" "backup_user" {
  statement {
    sid = "UploadBackups"
    actions = [
      "s3:PutObject",
      "s3:AbortMultipartUpload",
    ]
    resources = ["${aws_s3_bucket.backup.arn}/${var.backup_prefix}/*"]
  }
}

resource "aws_iam_user_policy" "backup" {
  name   = "upload-onprem-backup"
  user   = aws_iam_user.backup.name
  policy = data.aws_iam_policy_document.backup_user.json
}
