# 결제 서버 Instance Profile. Role 이름은 고정(var.payment_app_role_name)이다.
# 42 결제 DB Secret · 12 토스 Secret 정책과 43 큐 정책이 이 이름으로 결제 서버만 허용한다.
#
#   Session Manager       접속 (AmazonSSMManagedInstanceCore)
#   ECR pull              payment-service, payment-migrations 저장소만
#   SSM GetParameter      배포 이미지 태그 (11-registry, gitops merge 후 GitHub Actions 가 갱신)
#   Secret 조회           결제 DB 접속 정보(42), 토스 시크릿 키(12)
#   SQS SendMessage       결제 결과 큐(43)

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "app" {
  name               = var.payment_app_role_name
  description        = "Payment service instances"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "app_ssm" {
  role       = aws_iam_role.app.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "app" {
  name = var.payment_app_role_name
  role = aws_iam_role.app.name
}

data "aws_iam_policy_document" "app" {
  # 토큰 발급은 리소스 지정이 안 된다. 토큰만으로는 저장소 권한이 없으면 pull 할 수 없다
  statement {
    sid       = "GetEcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PullPaymentImages"
    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [
      for repo in var.image_repositories :
      "${local.arn_prefix}:ecr:${var.region}:${local.account_id}:repository/${var.project}/${repo}"
    ]
  }

  statement {
    sid       = "GetImageTag"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.arn_prefix}:ssm:${var.region}:${local.account_id}:parameter/${var.project}/${var.environment}/image-tag/payment-service"]
  }

  # Secret ARN 끝에는 무작위 6자가 붙는다
  statement {
    sid     = "GetPaymentSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "${local.arn_prefix}:secretsmanager:${var.region}:${local.account_id}:secret:${var.payment_db_secret_name}-??????",
      "${local.arn_prefix}:secretsmanager:${var.region}:${local.account_id}:secret:${local.secret_prefix}/toss-payments-??????",
    ]
  }

  statement {
    sid       = "SendPaymentResult"
    actions   = ["sqs:SendMessage"]
    resources = ["${local.arn_prefix}:sqs:${var.region}:${local.account_id}:${var.queue_names.payment_result}"]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "payment-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
