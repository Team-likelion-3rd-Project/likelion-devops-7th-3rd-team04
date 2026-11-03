# 웹훅을 큐로 넘기는 Lambda. 결제 VPC app 서브넷에 두고 SQS 인터페이스 엔드포인트로만 나간다 (30-security P6).
#
#   SQS SendMessage   웹훅 큐만
#   CloudWatch Logs   자기 로그 그룹만
#   ENI 관리          VPC 배치에 필요 (조회 API 와 ENI 생성은 리소스 지정이 안 된다)

data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/index.mjs"
  output_path = "${path.module}/build/lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = local.name
  description        = "Toss webhook Lambda"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "lambda" {
  statement {
    sid       = "SendWebhook"
    actions   = ["sqs:SendMessage"]
    resources = [aws_sqs_queue.webhook.arn]
  }

  statement {
    sid       = "WriteLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }

  statement {
    sid = "ManageVpcEni"
    actions = [
      "ec2:CreateNetworkInterface",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSubnets",
      "ec2:DeleteNetworkInterface",
      "ec2:AssignPrivateIpAddresses",
      "ec2:UnassignPrivateIpAddresses",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "webhook"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "webhook" {
  function_name = local.name
  description   = "Toss webhook to SQS"
  role          = aws_iam_role.lambda.arn

  # AWS SDK v3 는 Node.js 22 런타임에 포함되어 있어 패키지에 넣지 않는다
  runtime = "nodejs22.x"
  handler = "index.handler"

  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256

  timeout     = var.lambda_timeout
  memory_size = var.lambda_memory_size

  vpc_config {
    subnet_ids         = var.app_subnet_ids
    security_group_ids = [var.sg_ids["payment_lambda"]]
  }

  environment {
    variables = {
      PAYMENT_WEBHOOK_QUEUE_URL = aws_sqs_queue.webhook.url
    }
  }

  # 권한 · 로그 그룹이 먼저 있어야 한다. 없으면 Lambda 가 보존 기간 없는 로그 그룹을 스스로 만든다
  depends_on = [
    aws_iam_role_policy.lambda,
    aws_cloudwatch_log_group.lambda,
  ]
}
