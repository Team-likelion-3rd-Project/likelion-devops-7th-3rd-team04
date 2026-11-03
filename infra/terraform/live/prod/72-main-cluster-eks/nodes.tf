# AL2023 amd64 Managed Node Group. AMI 는 지정하지 않아 EKS 권장 AMI 를 쓴다 (nodeadm 부트스트랩은 MNG 가 넣는다).

data "aws_iam_policy_document" "node_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "node" {
  name               = "${local.name}-node"
  description        = "EKS managed nodes"
  assume_role_policy = data.aws_iam_policy_document.node_assume.json
}

# CNI 정책은 노드 Role 에 둔다. IMDS hop limit 1 이라 일반 파드는 노드 Role 을 쓸 수 없다
resource "aws_iam_role_policy_attachment" "node" {
  for_each = toset([
    "AmazonEKSWorkerNodePolicy",
    "AmazonEC2ContainerRegistryPullOnly",
    "AmazonEKS_CNI_Policy",
  ])

  role       = aws_iam_role.node.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/${each.value}"
}

# provider default_tags 는 시작 템플릿으로 띄운 인스턴스 · 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

resource "aws_launch_template" "node" {
  name = "${local.name}-node"

  # SG 를 지정하면 클러스터 SG 가 자동으로 붙지 않으므로 둘 다 적는다.
  #   클러스터 SG   컨트롤 플레인 ↔ 노드 · 파드, 노드 ↔ 노드 전체 (admission webhook · CoreDNS · 파드 간 통신)
  #   main_worker   RDS · Valkey · PrivateLink · ALB 규칙 (30-security, 70 과 같음)
  vpc_security_group_ids = [
    aws_eks_cluster.this.vpc_config[0].cluster_security_group_id,
    var.worker_sg_id,
  ]

  credit_specification {
    cpu_credits = "unlimited"
  }

  # hop limit 1: 컨테이너에서 IMDS 에 닿지 않아 파드는 Pod Identity 로만 권한을 받는다
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  block_device_mappings {
    device_name = "/dev/xvda"

    ebs {
      volume_type           = "gp3"
      volume_size           = var.node_root_volume_size
      encrypted             = true
      delete_on_termination = true
    }
  }

  # MNG 가 넣는 NodeConfig 와 합쳐진다
  user_data = base64encode(templatefile("${path.module}/templates/node-user-data.mime.tftpl", {
    max_pods = var.node_max_pods
  }))

  dynamic "tag_specifications" {
    for_each = ["instance", "volume"]

    content {
      resource_type = tag_specifications.value
      tags = merge(data.aws_default_tags.this.tags, {
        Name = "${local.name}-node"
      })
    }
  }

  tags = {
    Name = "${local.name}-node"
  }
}

resource "aws_eks_node_group" "worker" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "worker"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.worker_subnet_ids

  ami_type       = "AL2023_x86_64_STANDARD"
  capacity_type  = "ON_DEMAND"
  instance_types = [var.node_instance_type]

  launch_template {
    id      = aws_launch_template.node.id
    version = aws_launch_template.node.latest_version
  }

  scaling_config {
    desired_size = var.node_desired_size
    min_size     = var.node_min_size
    max_size     = var.node_max_size
  }

  depends_on = [
    aws_iam_role_policy_attachment.node,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
    aws_eks_addon.pod_identity_agent,
  ]
}
