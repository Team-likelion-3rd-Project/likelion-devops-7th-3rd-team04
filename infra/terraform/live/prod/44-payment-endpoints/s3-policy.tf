# S3 게이트웨이 엔드포인트 정책. 엔드포인트는 20-network(modules/vpc) 가 만들고 정책은 이 스택이 붙인다.
#
# 게이트웨이 엔드포인트는 S3 로 가는 모든 트래픽이 지나가고 NFW · DNS Firewall(*.amazonaws.com 허용) 을 거치지 않는다.
# 정책이 없으면(기본 전체 허용) 다른 계정 자격 증명으로 다른 계정 버킷에 쓸 수 있어 유출 경로가 된다.
# 결제 앱이 쓰는 버킷만 허용한다.
#   - 우리 계정 버킷
#   - ECR 이미지 레이어 버킷 (ECR pull 은 레이어를 AWS 소유 S3 버킷에서 받는다)
#   - AL2023 패키지 저장소 버킷 (dnf)
#
# 이 스택을 destroy 하면 정책이 기본값(전체 허용)으로 돌아간다. 엔드포인트 자체는 20-network 와 함께 삭제된다.

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  # AWS 문서의 고정 버킷 이름
  #   ECR   : https://docs.aws.amazon.com/AmazonECR/latest/userguide/vpc-endpoints.html
  #   AL2023: https://docs.aws.amazon.com/linux/al2023/ug/managing-repos-os-updates.html
  aws_owned_bucket_arns = [
    "arn:${data.aws_partition.current.partition}:s3:::prod-${var.region}-starport-layer-bucket/*",
    "arn:${data.aws_partition.current.partition}:s3:::al2023-repos-${var.region}-de612dc2/*",
  ]
}

data "aws_iam_policy_document" "s3_endpoint" {
  statement {
    sid       = "AllowOwnAccountBuckets"
    effect    = "Allow"
    actions   = ["s3:*"]
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }

  statement {
    sid       = "AllowAwsOwnedReadOnlyBuckets"
    effect    = "Allow"
    actions   = ["s3:GetObject"]
    resources = local.aws_owned_bucket_arns

    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_vpc_endpoint_policy" "s3" {
  vpc_endpoint_id = var.s3_gateway_endpoint_id
  policy          = data.aws_iam_policy_document.s3_endpoint.json
}
