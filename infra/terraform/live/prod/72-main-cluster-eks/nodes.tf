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

# 노드 그룹을 성격별로 나눈다 (LDP-248, 부하 테스트 3차).
#   platform  운영 도구(모니터링 · ArgoCD · Cluster Autoscaler 등) · 챗봇. 한 영역 1대 고정, taint 로 앱 Pod 를 막는다.
#             한 노드에 몰린 시스템 Pod 를 앱 분산 규칙(DoNotSchedule) 계산에서 빼서 확장 Pod Pending · 노드 과다 증설을 없앤다
#   app       앱 서비스. 가용 영역마다 하나 — 그룹 하나가 두 영역에 걸치면 ASG AZRebalance 가 영역 균형을 맞추려고 노드를
#             종료한다 (11-06 Prometheus 노드 종료). Cluster Autoscaler balance-similar-node-groups 가 두 그룹을 비슷하게 맞춘다
# taint 키는 CriticalAddonsOnly 를 쓰지 않는다 — coredns · ebs-csi-controller 가 허용하는 taint 라 둘 다 platform 1대로 몰릴 수 있다
locals {
  node_common = {
    ami_type       = "AL2023_x86_64_STANDARD"
    capacity_type  = "ON_DEMAND"
    instance_types = [var.node_instance_type]
  }
  # 앱 Pod 배치 · 축소 판단에서 platform 노드를 구분하는 라벨 · taint (gitops 값과 같아야 한다)
  platform_label = { role = "platform" }
  app_label      = { role = "app" }
}

resource "aws_eks_node_group" "platform" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "platform-${var.platform_az}"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = [var.worker_subnet_ids_by_az[var.platform_az]]

  ami_type       = local.node_common.ami_type
  capacity_type  = local.node_common.capacity_type
  instance_types = local.node_common.instance_types
  labels         = local.platform_label

  taint {
    key    = "dedicated"
    value  = "platform"
    effect = "NO_SCHEDULE"
  }

  launch_template {
    id      = aws_launch_template.node.id
    version = aws_launch_template.node.latest_version
  }

  # 1대 고정 — min = max 라 Cluster Autoscaler 가 늘리거나 줄이지 않는다
  scaling_config {
    desired_size = 1
    min_size     = 1
    max_size     = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.node,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
    aws_eks_addon.pod_identity_agent,
  ]
}

resource "aws_eks_node_group" "app" {
  for_each = var.worker_subnet_ids_by_az

  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "app-${each.key}"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = [each.value]

  ami_type       = local.node_common.ami_type
  capacity_type  = local.node_common.capacity_type
  instance_types = local.node_common.instance_types
  labels         = local.app_label

  launch_template {
    id      = aws_launch_template.node.id
    version = aws_launch_template.node.latest_version
  }

  # 노드 수는 Cluster Autoscaler 가 desired 를 바꿔 조절한다 (min ~ max, LDP-227). ASG 자동 발견 태그는 MNG 가 붙인다
  scaling_config {
    desired_size = var.app_node_desired_per_az
    min_size     = var.app_node_min_per_az
    max_size     = var.app_node_max_per_az
  }

  # Autoscaler 가 바꾼 desired 를 다음 apply 가 되돌리지 않게 한다. 노드 수를 직접 고정하려면 min · max 를 바꾼다.
  # min 을 지금 desired 보다 크게(또는 max 를 작게) 바꾸면 EKS 가 거절한다 → eks update-nodegroup-config 로 desired 를 먼저 맞춘다
  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [
    aws_iam_role_policy_attachment.node,
    aws_eks_addon.vpc_cni,
    aws_eks_addon.kube_proxy,
    aws_eks_addon.pod_identity_agent,
  ]
}

# destroy 뒤 남는 Prometheus EBS 정리 (LDP-248).
# PVC 보존 정책(whenDeleted: Delete)은 쿠버네티스 안에서 StatefulSet 을 지울 때만 동작한다. destroy 는 클러스터를 통째로 지워
# StatefulSet → PVC → EBS 삭제가 일어나기 전에 EBS CSI 컨트롤러도 사라지므로 볼륨이 남는다 (11-06 확인).
# 클러스터가 이 리소스에 의존하게 해서, destroy 때 클러스터(→ 노드 그룹)가 먼저 지워진 뒤 이 정리가 돈다 (볼륨이 떨어진 뒤)
resource "terraform_data" "pvc_volume_cleanup" {
  input = {
    region    = var.region
    namespace = "monitoring"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "bash ${path.module}/scripts/cleanup-pvc-volumes.sh ${self.input.region} ${self.input.namespace}"
  }
}
