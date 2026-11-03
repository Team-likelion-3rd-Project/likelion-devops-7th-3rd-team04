# 파드 권한. 앱 Role 은 51-pod-roles(70 · 72 공용), 여기서는 ns/SA 연결만 한다.
# 세션 태그를 끄지 않는다 — 51 신뢰 정책이 aws:RequestTag 의 네임스페이스 · ServiceAccount 를 비교한다.
# Role ARN 을 output 하지 않으므로 이름으로 만든다.
resource "aws_eks_pod_identity_association" "app" {
  for_each = var.pod_role_bindings

  cluster_name    = aws_eks_cluster.this.name
  namespace       = each.value.namespace
  service_account = each.value.service_account
  role_arn        = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:role/${each.value.role_name}"

  depends_on = [aws_eks_addon.pod_identity_agent]
}

# ── EKS 전용 Role (70 에 없는 컴포넌트) ──

locals {
  eks_only_roles = {
    aws-load-balancer-controller = {
      namespace       = "aws-load-balancer-controller"
      service_account = "aws-load-balancer-controller"
    }
    ebs-csi = {
      namespace       = "kube-system"
      service_account = "ebs-csi-controller-sa"
    }
  }
}

data "aws_iam_policy_document" "eks_only_assume" {
  for_each = local.eks_only_roles

  statement {
    actions = ["sts:AssumeRole", "sts:TagSession"]

    principals {
      type        = "Service"
      identifiers = ["pods.eks.amazonaws.com"]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = [local.cluster_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/kubernetes-namespace"
      values   = [each.value.namespace]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/kubernetes-service-account"
      values   = [each.value.service_account]
    }
  }
}

resource "aws_iam_role" "ebs_csi" {
  name               = "${var.project}-ebs-csi"
  description        = "EBS CSI driver controller"
  assume_role_policy = data.aws_iam_policy_document.eks_only_assume["ebs-csi"].json
}

resource "aws_iam_role_policy_attachment" "ebs_csi" {
  role       = aws_iam_role.ebs_csi.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy"
}

resource "aws_iam_role" "lb_controller" {
  name               = "${var.project}-aws-load-balancer-controller"
  description        = "AWS Load Balancer Controller (TargetGroupBinding only)"
  assume_role_policy = data.aws_iam_policy_document.eks_only_assume["aws-load-balancer-controller"].json
}

# TargetGroupBinding 만 쓴다 — ALB · 리스너 · SG 는 Terraform(80 · 30)이 관리하므로 만들거나 바꾸는 권한이 없다.
#   Describe          조회 API 는 리소스 지정을 지원하지 않는다
#   Register · Deregister  eks Target Group(Name 태그)에만. kubeadm TG 에는 등록할 수 없다
data "aws_iam_policy_document" "lb_controller" {
  statement {
    sid = "Describe"
    actions = [
      "ec2:DescribeAvailabilityZones",
      "ec2:DescribeInstances",
      "ec2:DescribeInternetGateways",
      "ec2:DescribeNetworkInterfaces",
      "ec2:DescribeSecurityGroups",
      "ec2:DescribeSubnets",
      "ec2:DescribeTags",
      "ec2:DescribeVpcs",
      "elasticloadbalancing:DescribeListeners",
      "elasticloadbalancing:DescribeLoadBalancers",
      "elasticloadbalancing:DescribeTags",
      "elasticloadbalancing:DescribeTargetGroupAttributes",
      "elasticloadbalancing:DescribeTargetGroups",
      "elasticloadbalancing:DescribeTargetHealth",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "ManageEksTargets"
    actions   = ["elasticloadbalancing:RegisterTargets", "elasticloadbalancing:DeregisterTargets"]
    resources = ["arn:${data.aws_partition.current.partition}:elasticloadbalancing:${var.region}:${data.aws_caller_identity.current.account_id}:targetgroup/*/*"]

    condition {
      test     = "StringEquals"
      variable = "aws:ResourceTag/Name"
      values   = [var.eks_target_group_name]
    }
  }
}

resource "aws_iam_role_policy" "lb_controller" {
  name   = "target-group-binding"
  role   = aws_iam_role.lb_controller.id
  policy = data.aws_iam_policy_document.lb_controller.json
}

resource "aws_eks_pod_identity_association" "lb_controller" {
  cluster_name    = aws_eks_cluster.this.name
  namespace       = local.eks_only_roles.aws-load-balancer-controller.namespace
  service_account = local.eks_only_roles.aws-load-balancer-controller.service_account
  role_arn        = aws_iam_role.lb_controller.arn

  depends_on = [aws_eks_addon.pod_identity_agent]
}
