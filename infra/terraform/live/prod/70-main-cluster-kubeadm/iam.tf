# 노드 Instance Profile. 지금은 SSM 접속 권한만 둔다.
# 부트스트랩(Ansible 묶음 S3 조회, join 정보 Parameter Store 읽기/쓰기) 권한은 CP 자동 부트스트랩 · 워커 자동 join 이슈에서 추가한다.
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
