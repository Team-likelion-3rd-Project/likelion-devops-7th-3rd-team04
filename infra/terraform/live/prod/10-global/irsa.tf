# kubeadm 클러스터용 자체 IRSA.
# 클러스터의 ServiceAccount 토큰 발급자(issuer)를 이 공개 버킷 URL 로 지정하면,
# IAM 이 버킷의 발급자 문서와 공개키(keys.json)로 토큰을 검증해 파드에 IAM Role 을 내어준다.
#
# 이 스택은 발급자 문서까지만 올린다. keys.json 은 클러스터의 SA 서명키로 만들어지므로 클러스터 구축 시 업로드한다.
# kube-apiserver 의 --service-account-issuer 는 output oidc_issuer_url 과 정확히 같아야 한다.

locals {
  oidc_issuer_url = "https://${var.oidc_bucket_name}.s3.${var.region}.amazonaws.com"
  oidc_public_keys = [
    ".well-known/openid-configuration",
    "keys.json",
  ]
}

resource "aws_s3_bucket" "oidc" {
  bucket = var.oidc_bucket_name

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_ownership_controls" "oidc" {
  bucket = aws_s3_bucket.oidc.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# IAM 이 익명으로 읽을 수 있어야 하므로 버킷 정책을 통한 공개만 허용한다 (ACL 공개는 계속 차단)
resource "aws_s3_bucket_public_access_block" "oidc" {
  bucket = aws_s3_bucket.oidc.id

  block_public_acls       = true
  block_public_policy     = false
  ignore_public_acls      = true
  restrict_public_buckets = false
}

resource "aws_s3_bucket_server_side_encryption_configuration" "oidc" {
  bucket = aws_s3_bucket.oidc.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# 공개 범위는 발급자 문서 두 개로 한정한다
data "aws_iam_policy_document" "oidc" {
  statement {
    sid       = "PublicReadOidcDocuments"
    actions   = ["s3:GetObject"]
    resources = [for key in local.oidc_public_keys : "${aws_s3_bucket.oidc.arn}/${key}"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.oidc.arn,
      "${aws_s3_bucket.oidc.arn}/*",
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

resource "aws_s3_bucket_policy" "oidc" {
  bucket = aws_s3_bucket.oidc.id
  policy = data.aws_iam_policy_document.oidc.json

  depends_on = [aws_s3_bucket_public_access_block.oidc]
}

resource "aws_s3_object" "oidc_discovery" {
  bucket       = aws_s3_bucket.oidc.id
  key          = ".well-known/openid-configuration"
  content_type = "application/json"

  content = jsonencode({
    issuer                                = local.oidc_issuer_url
    jwks_uri                              = "${local.oidc_issuer_url}/keys.json"
    authorization_endpoint                = "urn:kubernetes:programmatic_authorization"
    response_types_supported              = ["id_token"]
    subject_types_supported               = ["public"]
    id_token_signing_alg_values_supported = ["RS256"]
    claims_supported                      = ["sub", "iss"]
  })
}

# S3 인증서는 IAM 이 신뢰하는 CA 라 thumbprint 를 지정하지 않는다
resource "aws_iam_openid_connect_provider" "irsa" {
  url            = local.oidc_issuer_url
  client_id_list = ["sts.amazonaws.com"]

  # 생성 시 IAM 이 발급자 문서를 직접 읽어 검증하므로, 문서 업로드와 공개 정책이 먼저 끝나야 한다
  depends_on = [
    aws_s3_object.oidc_discovery,
    aws_s3_bucket_policy.oidc,
  ]
}
