# ArgoCD + root 앱. 70 의 Ansible roles/argocd aws.yml 과 같은 구조다 (값 · AppProject 를 바꾸면 양쪽을 같이 고친다).
# AppProject · Application 을 kubernetes_manifest 로 만들지 않는다 — plan 때 API 서버와 CRD 가 있어야 해서,
# 클러스터가 없는 매일 재생성에서 실패한다. helm_release 는 apply 때 렌더링한다.
# root 앱의 첫 sync 는 기다리지 않는다. 결과는 ArgoCD 가 계속 재시도한다.

locals {
  # 병행 기간에 gitops values-eks.yaml 이 끄는 작업을 다시 켠다 (enable_singleton_workloads).
  # 꺼져 있으면 키 자체를 넘기지 않아 values-eks.yaml 그대로 렌더링된다
  singleton_app_values = {
    backend = {
      migrations = { main = { enabled = true } }
      llmIngest  = { enabled = true }
      seed       = { enabled = true }
    }
    kube-prometheus-stack = {
      alertmanager = { config = { route = { receiver = "sns-alerts" } } }
    }
  }
}

resource "helm_release" "argocd" {
  name             = "argocd"
  repository       = "https://argoproj.github.io/argo-helm"
  chart            = "argo-cd"
  version          = var.argocd_chart_version
  namespace        = var.argocd_namespace
  create_namespace = true
  wait             = true
  timeout          = 600

  values = [templatefile("${path.module}/templates/argocd-values.yaml.tftpl", {
    sync_timeout_seconds = var.argocd_sync_timeout_seconds
  })]

  # ArgoCD 는 platform 노드에만 뜬다 (argocd-values nodeSelector · tolerations)
  depends_on = [
    aws_eks_access_policy_association.admin,
    aws_eks_node_group.platform,
    aws_eks_addon.coredns,
    aws_eks_pod_identity_association.app,
    aws_eks_pod_identity_association.lb_controller,
  ]
}

resource "helm_release" "argocd_bootstrap" {
  name      = "argocd-bootstrap"
  chart     = "${path.module}/charts/argocd-bootstrap"
  namespace = var.argocd_namespace

  values = [yamlencode({
    repoURL        = var.gitops_repo_url
    targetRevision = var.gitops_branch
    path           = var.gitops_apps_path
    rootValues = {
      cluster = "eks"
      deployNotify = {
        enabled = var.enable_singleton_workloads
      }
      appValues = merge(
        {
          aws-load-balancer-controller = {
            vpcId = var.vpc_id
          }
        },
        { for app, values in local.singleton_app_values : app => values if var.enable_singleton_workloads },
      )
    }
  })]

  # 계정 ID 가 plan 출력에 나오지 않게 한다
  set_sensitive = [{
    name  = "awsAccountId"
    value = data.aws_caller_identity.current.account_id
    type  = "string"
  }]

  depends_on = [helm_release.argocd]
}
