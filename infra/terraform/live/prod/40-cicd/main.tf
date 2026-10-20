# 운영 이미지 빌드 · ECR push 용 GitLab Runner (Deployment VPC runner 서브넷, ASG 1대).
#
#   Runner → (NAT) → Tailscale(tag:ci-runner, ephemeral) → 온프레미스 GitLab 443   job polling
#   job(kaniko, docker executor) → IMDS(hop limit 2) → Runner Role → ECR push      team04-hotel/* 만
#
# 부트스트랩은 70 과 같은 방식이다. user-data 가 S3 의 infra/ansible 묶음을 받아 aws-runner.yml 을 실행한다 (bootstrap.tf).
# Tailscale OAuth client · GitLab Runner 토큰은 🔒 12-secrets 의 Secret 에서 읽는다 (값 등록은 README 5절).
# Runner 는 GitLab 에 protected · tags aws, ecr 로 등록되어 있어 보호 브랜치의 aws 태그 job 만 받는다 (infra/ansible group_vars/gitlab.yml).
# 접속은 SSM Session Manager (22 포트, 키 페어 없음). 인스턴스는 Graviton(arm64) — 빌드한 이미지도 arm64 (운영 워커와 같음).

# Ansible preflight 가 Ubuntu 22.04 만 허용한다
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

# provider default_tags 는 시작 템플릿으로 띄운 인스턴스 · 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

locals {
  name = "${var.project}-ci-runner"

  # 12-secrets 와 같은 이름 규칙. 의존 관계 없이 이름으로 정책 ARN 을 만든다
  secret_prefix = "${var.project}/${var.environment}"
  secret_names = {
    tailscale = "${local.secret_prefix}/ci-runner-tailscale"
    gitlab    = "${local.secret_prefix}/ci-runner-gitlab"
  }
}

resource "aws_launch_template" "runner" {
  name                   = local.name
  image_id               = data.aws_ami.ubuntu.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [var.sg_ids.deployment_runner]

  iam_instance_profile {
    name = aws_iam_instance_profile.runner.name
  }

  user_data = base64encode(templatefile("${path.module}/templates/runner-user-data.sh.tftpl", {
    bucket               = aws_s3_bucket.ansible.id
    prefix               = local.ansible_prefix
    region               = var.region
    ansible_core_version = var.ansible_core_version
    extra_vars = jsonencode({
      aws_region                      = var.region
      ci_runner_tailscale_secret_name = local.secret_names.tailscale
      ci_runner_gitlab_secret_name    = local.secret_names.gitlab
    })
  }))

  # IMDSv2 강제. hop limit 2 라 docker executor 의 job 컨테이너도 Runner Role 자격 증명으로 ECR 에 push 한다.
  # 같은 이유로 job 은 Runner Secret 도 읽을 수 있다 — Runner 는 보호 브랜치 job 만 받는다 (README 13절)
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  block_device_mappings {
    device_name = data.aws_ami.ubuntu.root_device_name

    ebs {
      volume_type           = "gp3"
      volume_size           = var.root_volume_size
      encrypted             = true
      delete_on_termination = true
    }
  }

  dynamic "tag_specifications" {
    for_each = ["instance", "volume"]

    content {
      resource_type = tag_specifications.value
      tags = merge(data.aws_default_tags.this.tags, {
        Name = local.name
        Role = "ci-runner"
      })
    }
  }

  tags = {
    Name = local.name
  }

  # user-data 는 첫 부팅에만 실행되므로 묶음 업로드 · 권한이 먼저 있어야 한다
  depends_on = [
    aws_s3_object.ansible,
    aws_iam_role_policy.runner,
  ]
}

# 1대 고정. 부트스트랩이 실패하면 user-data 가 Unhealthy 를 보고해 교체된다
resource "aws_autoscaling_group" "runner" {
  name                = local.name
  vpc_zone_identifier = var.deployment_network.subnet_ids.runner
  desired_capacity    = 1
  min_size            = 1
  max_size            = 1

  health_check_type         = "EC2"
  health_check_grace_period = 300

  launch_template {
    id      = aws_launch_template.runner.id
    version = aws_launch_template.runner.latest_version
  }

  # default_tags 는 ASG 에 붙지 않는다. 인스턴스 태그는 시작 템플릿이 붙이므로 전파하지 않는다
  dynamic "tag" {
    for_each = merge(data.aws_default_tags.this.tags, { Name = local.name })

    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = false
    }
  }
}
