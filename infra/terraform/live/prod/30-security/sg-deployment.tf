# Deployment VPC SG 와 규칙 (설계 문서 4-3절 D1)
#
# GitLab Runner 는 인바운드가 없다. GitLab 과는 Runner 가 먼저 Tailscale 로 연결하고, 관리 접속은 SSM 이다.
# 아웃바운드는 노드 기본(전체 허용) 대신 쓰는 포트만 연다 (LDP-98).
#   443      GitLab(Tailscale DERP 릴레이) · ECR · S3 · SSM · Secrets Manager · Docker Hub 등 job 이미지
#   80       Ubuntu apt 저장소(HTTP)
#   41641    Tailscale 직접 연결(WireGuard, UDP)
#   3478     Tailscale STUN(UDP) — NAT 뒤에서 직접 연결 경로 탐색

locals {
  deployment_security_groups = {
    deployment_runner = { vpc = "deployment", description = "Deployment GitLab Runner" }
  }

  deployment_ingress_rules = {}

  deployment_egress_rules = {
    d1_runner_https     = { sg = "deployment_runner", cidr = "0.0.0.0/0", port = 443, description = "D1 HTTPS (GitLab via Tailscale DERP, ECR, AWS APIs)" }
    d1_runner_http      = { sg = "deployment_runner", cidr = "0.0.0.0/0", port = 80, description = "D1 HTTP (Ubuntu apt)" }
    d1_runner_wireguard = { sg = "deployment_runner", cidr = "0.0.0.0/0", protocol = "udp", port = 41641, description = "D1 Tailscale WireGuard" }
    d1_runner_stun      = { sg = "deployment_runner", cidr = "0.0.0.0/0", protocol = "udp", port = 3478, description = "D1 Tailscale STUN" }
  }
}
