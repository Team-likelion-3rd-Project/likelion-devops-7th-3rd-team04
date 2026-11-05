# 운영 부하 테스트용 k6 부하 생성기 (Main VPC public 서브넷, EIP).
#
#   부하 생성기(EIP) → IGW → 퍼블릭 ALB(443) → WAF → Traefik → 파드
#
# 출발지가 EIP 하나라 WAF rate limit(IP 하나당 waf_rate_limit)에 바로 걸린다. 80-main-edge 가 이 스택의
# waf_exempt_cidrs output 을 읽어 rate limit 규칙에서만 뺀다 (IP reputation · 관리형 규칙은 그대로 적용).
# 앱 throttler(THROTTLE_LIMIT) · 토큰 만료는 테스트 브랜치 gitops 에서 바꾼다.
#
# NAT 대신 public 서브넷 + EIP 인 이유: NAT EIP 는 워커 egress 와 같은 주소라 예외를 주면 클러스터 출발 요청까지 빠지고,
# 생성기 트래픽이 NAT 처리량 · 요금(GB 당)에 섞인다. 인바운드는 없고 접속은 Session Manager 로만 한다.
#
# EIP 를 ENI 에 먼저 붙이고 인스턴스가 그 ENI 로 부팅한다. 인스턴스 뒤에 EIP 를 붙이면 user-data 가
# 공인 IP 없이(외부 통신 불가) 먼저 돌아 k6 · 레포 다운로드가 실패한다.
#
# 매일 재생성 대상이지만 enable_load_generator 기본값이 false 라 테스트 날만 인스턴스 · EIP 가 생긴다.

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

data "aws_ami" "al2023" {
  owners = ["amazon"]

  filter {
    name   = "image-id"
    values = [nonsensitive(data.aws_ssm_parameter.al2023_ami.value)]
  }
}

data "aws_partition" "current" {}

locals {
  name = "${var.project}-load-generator"

  arn_prefix = "arn:${data.aws_partition.current.partition}"

  # 10-global 로그 버킷 안의 결과 경로 (Object Lock GOVERNANCE 보존 기간이 그대로 적용)
  result_prefix = "load-test/"

  # /etc/load-generator/config.env (README 의 결과 업로드 명령이 읽는다)
  config = {
    RESULT_BUCKET = var.log_bucket_name
    RESULT_PREFIX = local.result_prefix
    REPO_DIR      = "/home/loadtest/repo"
  }
}

# provider default_tags 는 인스턴스 루트 볼륨 · ENI 에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

resource "aws_network_interface" "generator" {
  count = var.enable_load_generator ? 1 : 0

  subnet_id       = var.public_subnet_id
  security_groups = [var.sg_ids["main_load_generator"]]
  description     = "Load generator (k6)"

  tags = {
    Name = local.name
  }
}

resource "aws_eip" "generator" {
  count = var.enable_load_generator ? 1 : 0

  domain            = "vpc"
  network_interface = aws_network_interface.generator[0].id

  tags = {
    Name = local.name
  }
}

resource "aws_instance" "generator" {
  count = var.enable_load_generator ? 1 : 0

  ami                  = data.aws_ami.al2023.id
  instance_type        = var.instance_type
  iam_instance_profile = aws_iam_instance_profile.generator.name

  primary_network_interface {
    network_interface_id = aws_network_interface.generator[0].id
  }

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    config     = local.config
    k6_version = var.k6_version
    k6_sha256  = var.k6_sha256
    repo_url   = var.repo_url
    repo_ref   = var.repo_ref
    public_ip  = aws_eip.generator[0].public_ip
  })
  user_data_replace_on_change = true

  # IMDSv2 강제, hop limit 1
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size
    encrypted             = true
    delete_on_termination = true
    tags                  = merge(data.aws_default_tags.this.tags, { Name = local.name })
  }

  tags = {
    Name = local.name
    Role = "load-generator"
  }

  # 최신 AMI 가 나와도 테스트 중인 생성기를 교체하지 않는다 (매일 재생성 때 반영)
  lifecycle {
    ignore_changes = [ami]
  }

  depends_on = [aws_iam_role_policy.generator]
}
