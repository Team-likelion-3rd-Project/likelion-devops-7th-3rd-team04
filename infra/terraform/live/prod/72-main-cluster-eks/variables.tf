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

# ── 다른 스택 output (terragrunt.hcl 의 dependency 가 넣는다) ──

variable "vpc_id" {
  description = "20-network main.vpc_id. LB Controller 가 IMDS 없이 VPC 를 알도록 root 앱으로 넘긴다"
  type        = string
}

variable "worker_subnet_ids" {
  description = "20-network main.subnet_ids.worker. 컨트롤 플레인 ENI · 노드 · 파드(VPC CNI)가 쓴다"
  type        = list(string)
}

variable "worker_sg_id" {
  description = "30-security sg_ids.main_worker. 70 과 같은 SG 라 RDS · Valkey · PrivateLink · ALB 규칙을 그대로 쓴다"
  type        = string
}

variable "pod_role_bindings" {
  description = "51-pod-roles 의 pod_role_bindings (Role 키 → role_name, namespace, service_account)"
  type = map(object({
    role_name       = string
    namespace       = string
    service_account = string
  }))
}

# ── 클러스터 ──

variable "cluster_name" {
  description = "EKS 클러스터 이름. 51-pod-roles eks_cluster_name 과 같아야 한다 (Pod Identity 신뢰 정책의 aws:SourceArn)"
  type        = string
  default     = "team04-hotel-main-eks"
}

variable "kubernetes_version" {
  description = "EKS 버전. 표준 지원 기간(1.35 는 2027-03-27 까지)을 넘기지 않는다"
  type        = string
  default     = "1.35"
}

variable "public_access_cidrs" {
  description = "API 서버 public endpoint 에 접근할 수 있는 출발지 (작업자 IP/32). terraform.tfvars(gitignore)에 넣는다. apply PC 의 helm provider 가 이 경로로 접속한다"
  type        = list(string)

  validation {
    condition     = length(var.public_access_cidrs) > 0 && alltrue([for c in var.public_access_cidrs : can(cidrhost(c, 0)) && endswith(c, "/32")])
    error_message = "public_access_cidrs 는 /32 IPv4 CIDR 이 하나 이상이어야 합니다 (비우면 EKS 기본값 0.0.0.0/0 이 됩니다)."
  }
}

variable "cluster_admin_principal_arns" {
  description = "실행 주체 외에 클러스터 관리자 Access Entry 를 줄 IAM ARN"
  type        = set(string)
  default     = []
}

# ── 노드 ──

variable "node_instance_type" {
  description = "Managed Node Group 인스턴스 타입 (x86_64)"
  type        = string
  default     = "t3a.large"
}

variable "node_desired_size" {
  description = "노드 희망 대수"
  type        = number
  default     = 2
}

variable "node_min_size" {
  description = "노드 최소 대수"
  type        = number
  default     = 2
}

variable "node_max_size" {
  description = "노드 최대 대수"
  type        = number
  default     = 4
}

variable "node_root_volume_size" {
  description = "노드 루트 볼륨 크기 (GiB, gp3)"
  type        = number
  default     = 30
}

variable "node_max_pods" {
  description = "노드당 최대 파드 수. prefix delegation 사용 시 vCPU 30 미만 인스턴스의 권장값"
  type        = number
  default     = 110
}

# ── ArgoCD ──

variable "argocd_chart_version" {
  description = "argo-cd 차트 버전. 70 · 온프레미스(Ansible group_vars/control_plane.yml argocd_chart_version)와 같게 둔다"
  type        = string
  default     = "10.10.3"
}

variable "argocd_namespace" {
  description = "ArgoCD 네임스페이스. 51-pod-roles deploy-notify 의 namespace 와 같아야 한다"
  type        = string
  default     = "argocd"
}

variable "gitops_repo_url" {
  description = "gitops 레포 (public, 자격 증명 없음)"
  type        = string
  default     = "https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04-gitops.git"
}

variable "gitops_branch" {
  description = "root 앱이 읽는 브랜치. 작업 브랜치 검증은 root 앱 targetRevision 을 patch 한다"
  type        = string
  default     = "main"
}

variable "gitops_apps_path" {
  description = "gitops 레포 안 root 차트 경로"
  type        = string
  default     = "envs/prod"
}

variable "argocd_sync_timeout_seconds" {
  description = "controller.sync.timeout.seconds (모든 Application 의 sync 시간 제한). 첫 sync 가 900 초를 넘겨 root 가 실패해(2026-11-02, backend 까지 15 분) 70 보다 길게 둔다 — 다음 재생성 실측으로 다시 정함"
  type        = number
  default     = 1800
}

variable "enable_singleton_workloads" {
  description = "한 클러스터에서만 돌아야 하는 작업(마이그레이션 · seed · llm-ingest · Alertmanager 발행 · 배포 알림)을 이 클러스터에서 켤지 여부. 70 제거(LDP-202) 후 이 클러스터만 남아 기본으로 켠다 — 끄면 매일 재생성에서 마이그레이션 · seed 가 돌지 않는다"
  type        = bool
  default     = true
}

variable "eks_target_group_name" {
  description = "80-main-edge eks Target Group 의 Name 태그. LB Controller 는 이 태그가 붙은 TG 에만 대상을 등록 · 해제한다"
  type        = string
  default     = "team04-hotel-main-eks"
}
