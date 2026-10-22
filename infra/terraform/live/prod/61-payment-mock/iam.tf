# pg-mock Instance Profile. Session Manager 접속, pg-mock-service 이미지 pull · 태그 조회만 둔다.
# 비밀값 · 큐 권한은 없다. enable_pg_mock = false 여도 Role 은 남긴다 (무료, 켤 때 바로 쓰도록)

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "mock" {
  name               = local.name
  description        = "Payment PG mock instance (load test)"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "mock_ssm" {
  role       = aws_iam_role.mock.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "mock" {
  name = local.name
  role = aws_iam_role.mock.name
}

data "aws_iam_policy_document" "mock" {
  # 토큰 발급은 리소스 지정이 안 된다. 토큰만으로는 저장소 권한이 없으면 pull 할 수 없다
  statement {
    sid       = "GetEcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PullMockImage"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = ["${local.arn_prefix}:ecr:${var.region}:${local.account_id}:repository/${var.project}/pg-mock-service"]
  }

  statement {
    sid       = "GetImageTag"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.arn_prefix}:ssm:${var.region}:${local.account_id}:parameter/${var.project}/${var.environment}/image-tag/pg-mock-service"]
  }
}

resource "aws_iam_role_policy" "mock" {
  name   = "payment-mock"
  role   = aws_iam_role.mock.id
  policy = data.aws_iam_policy_document.mock.json
}
