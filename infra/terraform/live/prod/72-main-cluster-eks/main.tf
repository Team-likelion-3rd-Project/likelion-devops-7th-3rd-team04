# 운영 메인 EKS 클러스터 (LDP-201). 70-main-cluster-kubeadm 과 같은 gitops 정의로 같은 앱을 띄운다.
#
#   클러스터 · 노드 · 애드온 · Pod Identity Association · ArgoCD · root 앱     이 스택
#   나머지 앱 (Traefik · LB Controller · backend ...)                         ArgoCD (infra/gitops/prod)
#   ALB · Target Group                                                        80-main-edge (72 보다 뒤라 TargetGroupBinding 은 TG 이름으로 찾는다)
#
# 애드온 순서: vpc-cni · kube-proxy · eks-pod-identity-agent(DaemonSet, 노드 준비에 필요) → 노드 → coredns · ebs-csi(Deployment, 노드 필요)

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  name = "${var.project}-main-eks"

  # Role 신뢰 정책이 클러스터를 참조하면 Role → 클러스터 순서가 꼬이므로 이름으로 만든다 (51-pod-roles 와 같은 방식)
  cluster_arn = "arn:${data.aws_partition.current.partition}:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${var.cluster_name}"

  # apply 주체는 항상 관리자여야 helm provider 가 접속한다
  cluster_admin_principal_arns = setunion(var.cluster_admin_principal_arns, [data.aws_iam_session_context.current.issuer_arn])
}

# ── 컨트롤 플레인 ──

data "aws_iam_policy_document" "cluster_assume" {
  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["eks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cluster" {
  name               = "${local.name}-cluster"
  description        = "EKS control plane"
  assume_role_policy = data.aws_iam_policy_document.cluster_assume.json
}

resource "aws_iam_role_policy_attachment" "cluster" {
  role       = aws_iam_role.cluster.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  version  = var.kubernetes_version
  role_arn = aws_iam_role.cluster.arn

  # 애드온을 aws_eks_addon 으로만 관리한다
  bootstrap_self_managed_addons = false

  access_config {
    authentication_mode                         = "API"
    bootstrap_cluster_creator_admin_permissions = false
  }

  # 연장 지원(시간당 $0.60)으로 넘어가지 않게 한다
  upgrade_policy {
    support_type = "STANDARD"
  }

  vpc_config {
    subnet_ids              = var.worker_subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = var.public_access_cidrs
  }

  depends_on = [aws_iam_role_policy_attachment.cluster]
}

resource "aws_eks_access_entry" "admin" {
  for_each = local.cluster_admin_principal_arns

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
}

resource "aws_eks_access_policy_association" "admin" {
  for_each = local.cluster_admin_principal_arns

  cluster_name  = aws_eks_cluster.this.name
  principal_arn = each.value
  policy_arn    = "arn:${data.aws_partition.current.partition}:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }

  depends_on = [aws_eks_access_entry.admin]
}

# ── 노드 전에 필요한 애드온 ──

resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "vpc-cni"

  # prefix delegation: ENI 슬롯마다 /28 을 받아 노드당 파드 110 개를 쓴다. 처음부터 켠다 (켠 뒤 새 노드부터 적용되므로)
  configuration_values = jsonencode({
    env = {
      ENABLE_PREFIX_DELEGATION = "true"
      WARM_PREFIX_TARGET       = "1"
    }
  })
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "kube-proxy"
}

resource "aws_eks_addon" "pod_identity_agent" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "eks-pod-identity-agent"
}

# ── 노드 뒤에 필요한 애드온 ──

resource "aws_eks_addon" "coredns" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "coredns"

  depends_on = [aws_eks_node_group.worker]
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "aws-ebs-csi-driver"

  pod_identity_association {
    role_arn        = aws_iam_role.ebs_csi.arn
    service_account = "ebs-csi-controller-sa"
  }

  depends_on = [
    aws_eks_node_group.worker,
    aws_eks_addon.pod_identity_agent,
    aws_iam_role_policy_attachment.ebs_csi,
  ]
}
