# 노드 Instance Profile. SSM 접속 권한과 부트스트랩(Ansible 묶음 S3 조회, join 정보 Parameter Store) 권한을 둔다.
# 파드의 AWS 권한은 노드 Role 이 아니라 IRSA 로 준다.

locals {
  node_roles = {
    cp     = "Main kubeadm control plane nodes"
    worker = "Main kubernetes worker nodes"
  }
}

data "aws_iam_policy_document" "ec2_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  for_each = local.node_roles

  name               = "${local.name}-${each.key}"
  description        = each.value
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
}

resource "aws_iam_role_policy_attachment" "node_ssm" {
  for_each = local.node_roles

  role       = aws_iam_role.node[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "node" {
  for_each = local.node_roles

  name = "${local.name}-${each.key}"
  role = aws_iam_role.node[each.key].name
}

# 부트스트랩 공통: Ansible 묶음 다운로드, join token · CA cert hash 조회
data "aws_iam_policy_document" "node_bootstrap" {
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

  statement {
    sid     = "GetJoinParameters"
    actions = ["ssm:GetParameter"]
    resources = [
      aws_ssm_parameter.join_token.arn,
      aws_ssm_parameter.ca_cert_hash.arn,
    ]
  }
}

# CP: 공통 + certificate-key 조회, CA cert hash 기록, join token 갱신
data "aws_iam_policy_document" "cp_bootstrap" {
  source_policy_documents = [data.aws_iam_policy_document.node_bootstrap.json]

  statement {
    sid       = "GetCertificateKey"
    actions   = ["ssm:GetParameter"]
    resources = [aws_ssm_parameter.certificate_key.arn]
  }

  statement {
    sid     = "PutJoinParameters"
    actions = ["ssm:PutParameter"]
    resources = [
      aws_ssm_parameter.ca_cert_hash.arn,
      aws_ssm_parameter.join_token.arn,
    ]
  }
}

resource "aws_iam_role_policy" "cp_bootstrap" {
  name   = "bootstrap"
  role   = aws_iam_role.node["cp"].id
  policy = data.aws_iam_policy_document.cp_bootstrap.json
}

# 워커: 공통만. certificate-key(CP 인증서 복호화 키) 는 읽지 못한다
resource "aws_iam_role_policy" "worker_bootstrap" {
  name   = "bootstrap"
  role   = aws_iam_role.node["worker"].id
  policy = data.aws_iam_policy_document.node_bootstrap.json
}
