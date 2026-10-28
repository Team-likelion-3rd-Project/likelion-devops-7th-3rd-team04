variable "project" {
  description = "리소스 이름/태그에 사용할 프로젝트 이름"
  type        = string
  default     = "team04-hotel"
}

variable "environment" {
  description = "환경 이름"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "리전"
  type        = string
  default     = "us-east-1"
}

# ── 메인 클러스터 로그 그룹 (Fluent Bit cloudwatch_logs 출력) ──

variable "cluster_log_namespaces" {
  description = <<-EOT
    로그 그룹을 따로 두는 네임스페이스. 여기 없는 네임스페이스의 로그는 other 그룹으로 간다.
    gitops fluent-bit/values.yaml 의 Lua 필터 목록(known)과 같아야 한다 (Fluent Bit 은 그룹을 만들지 않는다)
  EOT
  type        = list(string)
  default = [
    # Kubernetes · CNI (kubeadm · Ansible)
    "kube-system",
    "tigera-operator",
    "calico-system",
    "calico-apiserver",
    # 배포 (ArgoCD, Ansible roles/argocd)
    "argocd",
    # gitops 앱 (infra/gitops/prod/*/chart.yaml 의 namespace)
    "traefik",
    "cert-manager",
    "pod-identity-webhook",
    "fluent-bit",
    "whoami",
    "external-secrets",
    "backend",
  ]
}

variable "cluster_log_retention_days" {
  description = "클러스터 로그 그룹 보존 기간(일). 매일 destroy 로 그룹째 지워지므로 장기 보관은 로그 버킷 app-logs/ 가 맡는다"
  type        = number
  default     = 7
}
