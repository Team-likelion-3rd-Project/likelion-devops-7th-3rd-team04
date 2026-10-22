# 결제 서버 ASG (app 서브넷 a · b). 새로 뜬 인스턴스(최초 · 교체 · 확장)는 user-data 로 부트스트랩한다.
# NLB Target Group 헬스체크(GET /health)가 실패하면 ASG 가 교체한다.
#
# 기본 1대로 시작한다. 2대 이상은 LDP-116 의 순차 교체(배포 중 동시 재시작 방지)가 검증된 뒤 기본값을 올린다.
# 대수와 관계없이 NLB cross-zone 으로 메인 쪽 엔드포인트(AZ a · b) 모두에서 도달한다.

# provider default_tags 는 시작 템플릿으로 띄운 인스턴스 · 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

resource "aws_launch_template" "app" {
  name                   = "${local.name}-app"
  image_id               = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [local.sg_ids.payment_app]

  iam_instance_profile {
    name = aws_iam_instance_profile.app.name
  }

  user_data = base64encode(templatefile("${path.module}/templates/user-data.sh.tftpl", {
    grpc_port   = var.grpc_port
    health_port = var.health_port
  }))

  metadata_options {
    http_endpoint               = local.metadata_options.http_endpoint
    http_tokens                 = local.metadata_options.http_tokens
    http_put_response_hop_limit = local.metadata_options.http_put_response_hop_limit
  }

  block_device_mappings {
    device_name = data.aws_ami.al2023.root_device_name

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
        Name = "${local.name}-app"
        Role = "payment-app"
      })
    }
  }

  tags = {
    Name = "${local.name}-app"
  }

  # user-data 는 첫 부팅에만 실행되므로 권한이 먼저 있어야 한다
  depends_on = [aws_iam_role_policy.app]
}

resource "aws_autoscaling_group" "app" {
  name                = "${local.name}-app"
  vpc_zone_identifier = local.network.subnet_ids.app
  desired_capacity    = var.desired_capacity
  min_size            = var.min_size
  max_size            = var.max_size

  # 부팅 · docker 설치(검증용 리스너) 동안은 판단하지 않는다. LDP-116 에서 배포 시간에 맞춰 조정
  health_check_type         = "ELB"
  health_check_grace_period = var.health_check_grace_period

  # 시작 템플릿이 바뀌어도 기존 인스턴스는 그대로 두고 새로 뜨는 인스턴스부터 반영한다
  launch_template {
    id      = aws_launch_template.app.id
    version = aws_launch_template.app.latest_version
  }

  # default_tags 는 ASG 에 붙지 않는다. 인스턴스 태그는 시작 템플릿이 붙이므로 전파하지 않는다
  dynamic "tag" {
    for_each = merge(data.aws_default_tags.this.tags, { Name = "${local.name}-app" })

    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = false
    }
  }

  lifecycle {
    precondition {
      condition     = var.min_size <= var.desired_capacity && var.desired_capacity <= var.max_size
      error_message = "min_size <= desired_capacity <= max_size 여야 합니다."
    }
  }
}
