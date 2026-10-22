# 결제 서버 Instance Profile. Role 이름은 고정(var.payment_app_role_name)이다.
# 42 결제 DB Secret · 12 토스 Secret 정책과 43 큐 정책이 이 이름으로 결제 서버만 허용한다.
#
#   Session Manager       접속 (AmazonSSMManagedInstanceCore)
#   ECR pull              payment-service, payment-migrations 저장소만
#   SSM GetParameter      배포 release {image_tag, env} (11-registry, gitops merge 후 GitHub Actions 가 갱신). 쓰기 권한 없음
#   Secret 조회           결제 DB 접속 정보(42), 토스 시크릿 키(12)
#   SQS SendMessage       결제 결과 큐(43)
#   ASG Standby           배포 중 자기 ASG 에서 Standby 진입 · 해제 (NLB drain)
#   CloudWatch Logs       컨테이너 로그 · 배포 이벤트 (logs.tf 로그 그룹만)
#
# AmazonSSMManagedInstanceCore 에는 ssm:PutParameter 가 없다 (Session Manager · Run Command 수신용 권한만)

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
    sid       = "GetRelease"
    actions   = ["ssm:GetParameter"]
    resources = ["${local.arn_prefix}:ssm:${var.region}:${local.account_id}:parameter${local.release_parameter}"]
  }

  # Secret ARN 끝에는 무작위 6자가 붙는다
  statement {
    sid     = "GetPaymentSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      "${local.arn_prefix}:secretsmanager:${var.region}:${local.account_id}:secret:${var.payment_db_secret_name}-??????",
      "${local.arn_prefix}:secretsmanager:${var.region}:${local.account_id}:secret:${local.toss_secret_name}-??????",
    ]
  }

  statement {
    sid       = "SendPaymentResult"
    actions   = ["sqs:SendMessage"]
    resources = ["${local.arn_prefix}:sqs:${var.region}:${local.account_id}:${var.queue_names.payment_result}"]
  }

  # 조회 API 는 리소스 지정이 안 된다
  statement {
    sid = "DescribeAutoScaling"
    actions = [
      "autoscaling:DescribeAutoScalingGroups",
      "autoscaling:DescribeAutoScalingInstances",
    ]
    resources = ["*"]
  }

  # ASG ARN 에는 무작위 ID 가 들어간다. ASG 를 참조하면 ASG → 시작 템플릿 → 이 정책 순환이 생겨 이름으로 맞춘다
  statement {
    sid = "StandbyOwnAsg"
    actions = [
      "autoscaling:EnterStandby",
      "autoscaling:ExitStandby",
    ]
    resources = ["${local.arn_prefix}:autoscaling:${var.region}:${local.account_id}:autoScalingGroup:*:autoScalingGroupName/${local.asg_name}"]
  }

  statement {
    sid = "WriteLogs"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = [
      "${aws_cloudwatch_log_group.app.arn}:log-stream:*",
      "${aws_cloudwatch_log_group.deploy.arn}:log-stream:*",
    ]
  }
}

resource "aws_iam_role_policy" "app" {
  name   = "payment-app"
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}
