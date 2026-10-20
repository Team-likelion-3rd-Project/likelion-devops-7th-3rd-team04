# Runner Instance Profile. job 컨테이너도 IMDS(hop limit 2)로 이 Role 을 쓴다.
#   SSM 접속, 부트스트랩(Ansible 묶음 S3 조회), Runner Secret 조회, ECR push(team04-hotel/* 만), 실패 시 ASG Unhealthy 보고
# 이름은 12-secrets 의 Secret 리소스 정책(ci_runner_role_name)과 같아야 한다

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runner" {
  name               = local.name
  description        = "AWS GitLab Runner (ECR push, protected branch jobs)"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "runner_ssm" {
  role       = aws_iam_role.runner.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "runner" {
  name = local.name
  role = aws_iam_role.runner.name
}

locals {
  account_arn_prefix = "${data.aws_partition.current.partition}:%s:${var.region}:${data.aws_caller_identity.current.account_id}"
}

data "aws_iam_policy_document" "runner" {
  statement {
    sid       = "ListAnsibleBundle"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.ansible.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["${local.ansible_prefix}/*"]
    }
  }

  statement {
    sid       = "GetAnsibleBundle"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.ansible.arn}/${local.ansible_prefix}/*"]
  }

  # 12-secrets 의 Runner Secret 2개만. ARN 끝의 무작위 6자는 ?????? 로 맞춘다
  statement {
    sid     = "GetRunnerSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      for name in values(local.secret_names) :
      "arn:${format(local.account_arn_prefix, "secretsmanager")}:secret:${name}-??????"
    ]
  }

  # 토큰 발급은 리소스 지정이 안 된다. 토큰만으로는 저장소 권한이 없으면 push · pull 할 수 없다
  statement {
    sid       = "GetEcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # 11-registry 의 프로젝트 저장소(<project>/*)만. kaniko 는 push 전 레이어 존재 확인 · 기존 이미지 조회도 한다
  statement {
    sid = "PushProjectImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = ["arn:${format(local.account_arn_prefix, "ecr")}:repository/${var.project}/*"]
  }
}

resource "aws_iam_role_policy" "runner" {
  name   = "runner"
  role   = aws_iam_role.runner.id
  policy = data.aws_iam_policy_document.runner.json
}

# 부트스트랩 실패 시 자기 ASG 에 Unhealthy 보고 (user-data trap) → ASG 가 교체.
# ASG 를 참조하므로 시작 템플릿이 기다리는 위 정책과 분리한다 (순환 참조 방지, 70 과 같음)
data "aws_iam_policy_document" "runner_health" {
  statement {
    sid       = "ReportBootstrapFailure"
    actions   = ["autoscaling:SetInstanceHealth"]
    resources = [aws_autoscaling_group.runner.arn]
  }
}

resource "aws_iam_role_policy" "runner_health" {
  name   = "health"
  role   = aws_iam_role.runner.id
  policy = data.aws_iam_policy_document.runner_health.json
}
