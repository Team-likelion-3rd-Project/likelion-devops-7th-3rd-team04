# 부하 생성기 Instance Profile. Session Manager 접속, k6 결과 업로드(로그 버킷 load-test/ 쓰기)만 둔다.
# 운영 API 는 공개 엔드포인트로만 호출하므로 비밀값 · 클러스터 권한은 없다.
# enable_load_generator = false 여도 Role 은 남긴다 (무료, 켤 때 바로 쓰도록)

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "generator" {
  name               = local.name
  description        = "k6 load generator instance (load test)"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "generator_ssm" {
  role       = aws_iam_role.generator.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "generator" {
  name = local.name
  role = aws_iam_role.generator.name
}

data "aws_iam_policy_document" "generator" {
  # 올리기만 한다. 덮어쓰기는 버전 관리 · Object Lock 이라 이전 결과가 지워지지 않는다
  statement {
    sid       = "PutResult"
    actions   = ["s3:PutObject"]
    resources = ["${local.arn_prefix}:s3:::${var.log_bucket_name}/${local.result_prefix}*"]
  }
}

resource "aws_iam_role_policy" "generator" {
  name   = "load-generator"
  role   = aws_iam_role.generator.id
  policy = data.aws_iam_policy_document.generator.json
}
