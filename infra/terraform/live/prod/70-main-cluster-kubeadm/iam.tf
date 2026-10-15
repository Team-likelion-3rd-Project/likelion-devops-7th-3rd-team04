# 노드 Instance Profile. SSM 접속 권한, 부트스트랩(Ansible 묶음 S3 조회, join 정보 Parameter Store) 권한,
# 노드 수명주기(CCM · NTH, 부트스트랩 실패 보고, CP reconcile) 권한을 둔다.
# 파드의 AWS 권한은 노드 Role 이 아니라 IRSA 로 준다 (CP 에 hostNetwork 로 뜨는 CCM · NTH 만 예외).

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

# CP: 노드 수명주기 (aws_node_lifecycle role). CCM · NTH 가 CP 에 hostNetwork 로 떠서 이 Role 을 쓴다
data "aws_iam_policy_document" "cp_node_lifecycle" {
  # CCM 노드 컨트롤러: 인스턴스 ID · 주소 · zone 조회, 종료 여부 확인. Describe 는 리소스 지정이 안 된다
  # NTH: 이벤트의 인스턴스 → Node 이름(private DNS) · 태그 · ASG 확인
  # CP reconcile timer: etcd 멤버 이름(private DNS) 의 인스턴스가 살아 있는지 확인
  statement {
    sid = "DescribeNodes"
    actions = [
      "ec2:DescribeInstances",
      "ec2:DescribeInstanceTopology",
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeRegions",
      "autoscaling:DescribeAutoScalingInstances",
      "autoscaling:DescribeTags",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ReceiveNodeEvents"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage"]
    resources = [aws_sqs_queue.nth.arn]
  }

  statement {
    sid       = "CompleteWorkerTermination"
    actions   = ["autoscaling:CompleteLifecycleAction"]
    resources = [aws_autoscaling_group.worker.arn]
  }
}

resource "aws_iam_role_policy" "cp_node_lifecycle" {
  name   = "node-lifecycle"
  role   = aws_iam_role.node["cp"].id
  policy = data.aws_iam_policy_document.cp_node_lifecycle.json
}

# 부트스트랩 실패 시 자기 ASG 에 Unhealthy 보고 (user-data trap) → ASG 가 교체
data "aws_iam_policy_document" "cp_health" {
  statement {
    sid       = "ReportBootstrapFailure"
    actions   = ["autoscaling:SetInstanceHealth"]
    resources = [for g in aws_autoscaling_group.cp : g.arn]
  }
}

resource "aws_iam_role_policy" "cp_health" {
  name   = "health"
  role   = aws_iam_role.node["cp"].id
  policy = data.aws_iam_policy_document.cp_health.json
}

data "aws_iam_policy_document" "worker_health" {
  statement {
    sid       = "ReportBootstrapFailure"
    actions   = ["autoscaling:SetInstanceHealth"]
    resources = [aws_autoscaling_group.worker.arn]
  }
}

resource "aws_iam_role_policy" "worker_health" {
  name   = "health"
  role   = aws_iam_role.node["worker"].id
  policy = data.aws_iam_policy_document.worker_health.json
}
