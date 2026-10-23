# 부하 테스트용 pg-mock 인스턴스 (결제 VPC app-a 서브넷, 고정 private IP).
#
#   결제 서버 → pg-mock <고정 IP>:3007   SG: 30-security payment_app → payment_mock (P7)
#   결제 서버 PAYMENT_PROVIDER=MOCK 일 때 PG_MOCK_SERVICE_URL 로 쓴다 (전환은 gitops envs/prod/payment/values.yaml PR)
#
# 결제 서버와 분리한 이유: 결제 서버를 늘려도 mock 은 하나면 되고(인스턴스마다 mock 상태가 갈리지 않음),
# 부하 테스트 때 mock 이 결제 서버 자원을 나눠 쓰지 않아 결제 서버 처리량을 그대로 잴 수 있다.
# 자가 복구가 필요 없어 ASG 없이 인스턴스 1대로 두고, 필요 없으면 enable_pg_mock = false 로 끈다.
#
# 주소는 이름 대신 고정 IP 다. 이름을 쓰면 결제 VPC 에 private zone 을 두고 DNS Firewall 허용 목록을 넓혀야 한다.
# 고정 IP 는 20-network 가 자동 할당에서 뺀 대역(payment.app_static_cidr) 안에서 고르므로 다른 ENI 와 겹치지 않는다.
#
# 배포는 결제 서버와 같은 방식이다: 인스턴스 안의 pull agent(templates/pg-mock-deploy.sh)가 1분마다
# 결제 서버 release 파라미터의 image_tag 를 읽어 pg-mock-service 를 교체한다 (릴리스는 모든 서비스를 같은 SHA 로 빌드).

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ami" "al2023" {
  owners = ["amazon"]

  filter {
    name   = "image-id"
    values = [nonsensitive(data.aws_ssm_parameter.al2023_ami.value)]
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  name = "${var.project}-payment-mock"

  arn_prefix = "arn:${data.aws_partition.current.partition}"
  account_id = data.aws_caller_identity.current.account_id

  private_ip = cidrhost(var.static_cidr, var.private_ip_hostnum)

  # 11-registry 의 결제 서버 release 파라미터 (같은 이름 규칙, 스택 의존 없음). image_tag 만 쓴다
  release_parameter = "/${var.project}/${var.environment}/payment/release"

  # /etc/pg-mock-deploy/config.env (pg-mock-deploy.sh 가 읽는다). 계정 ID 는 agent 가 IMDS 에서 읽는다
  deploy_config = {
    REGION            = var.region
    RELEASE_PARAMETER = local.release_parameter
    REPOSITORY        = "${var.project}/pg-mock-service"
    MOCK_PORT         = var.mock_port
    HEALTH_TIMEOUT    = 90
  }
}

# provider default_tags 는 인스턴스 루트 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

resource "aws_instance" "mock" {
  count = var.enable_pg_mock ? 1 : 0

  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = var.app_subnet_id
  private_ip             = local.private_ip
  vpc_security_group_ids = [var.sg_ids["payment_mock"]]
  iam_instance_profile   = aws_iam_instance_profile.mock.name

  user_data = templatefile("${path.module}/templates/user-data.sh.tftpl", {
    config       = local.deploy_config
    agent_script = trimspace(file("${path.module}/templates/pg-mock-deploy.sh"))
  })
  user_data_replace_on_change = true

  # IMDSv2 강제, hop limit 1. 컨테이너는 host 네트워크로 띄운다 (LDP-116)
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
    Role = "payment-mock"
  }

  # 최신 AMI 가 나와도 떠 있는 mock 을 교체하지 않는다 (매일 재생성 때 반영)
  lifecycle {
    ignore_changes = [ami]
  }

  depends_on = [aws_iam_role_policy.mock]
}
