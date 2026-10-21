# Main VPC 의 kubeadm 클러스터 노드와 kube-apiserver 내부 NLB.
#
#   컨트롤 플레인  cp 서브넷 a · b · c 에 AZ 별 ASG 1대씩 (스택형 etcd 쿼럼 유지)
#   내부 NLB       cp 서브넷 a · b · c, TCP 6443 → CP. controlPlaneEndpoint 로 쓴다
#   워커           worker 서브넷 a · b 의 ASG
#
# Terraform 범위는 EC2 · 네트워크까지다. kubeadm · containerd · Calico 설치와 워커 join 은
# user-data 가 Ansible 을 실행해 처리한다 (bootstrap.tf). Traefik 등 클러스터 서비스는 Ansible 이 설치한
# GitOps pull 배포 agent 가 gitops 레포에서 설치한다 (infra/gitops/prod).
# 노드 접속은 SSM Session Manager 로 한다 (22 포트, 키 페어 없음).

# Ansible preflight 가 Ubuntu 22.04 만 허용한다. 노드는 Graviton(arm64)
data "aws_ssm_parameter" "ubuntu_ami" {
  name = "/aws/service/canonical/ubuntu/server/22.04/stable/current/arm64/hvm/ebs-gp2/ami-id"
}

data "aws_ami" "ubuntu" {
  owners = ["099720109477"] # Canonical

  filter {
    name   = "image-id"
    values = [nonsensitive(data.aws_ssm_parameter.ubuntu_ami.value)]
  }
}

locals {
  name = "${var.project}-main"

  network = var.main_network
  sg_ids  = var.sg_ids

  # AZ 접미사 → cp 서브넷 ID. 20-network enable_control_plane_subnets = false 면 cp 계층이 없다
  cp_subnet_ids = try(local.network.subnet_ids_by_az.cp, {})

  # aws-cloud-controller-manager 가 클러스터 소속 인스턴스를 구분하는 태그 (CP · 워커)
  cluster_tags = {
    "kubernetes.io/cluster/${local.name}" = "owned"
  }

  # IMDSv2 강제. hop limit 1 이라 파드(호스트 네트워크 제외) 는 노드 Role 자격 증명을 얻지 못한다 → 파드 권한은 IRSA
  metadata_options = {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
}
