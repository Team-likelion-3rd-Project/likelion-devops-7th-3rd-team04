# 워커 ASG. 새로 뜬 인스턴스(최초 · 교체 · 확장) 는 user-data 가 aws-worker.yml 을 실행해 클러스터에 join 한다.
# 스케일 인 · 교체 때 기존 Node 객체는 NotReady 로 남는다 (drain · 삭제 자동화 없음, README 6절).
# ALB Target Group 연결(aws_autoscaling_attachment) 은 사용하는 쪽인 80-main-edge 에 둔다.

# provider default_tags 는 시작 템플릿으로 띄운 인스턴스 · 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

resource "aws_launch_template" "worker" {
  name                   = "${local.name}-worker"
  image_id               = data.aws_ami.ubuntu.id
  instance_type          = var.worker_instance_type
  vpc_security_group_ids = [local.sg_ids.main_worker]

  iam_instance_profile {
    name = aws_iam_instance_profile.node["worker"].name
  }

  user_data = base64encode(templatefile("${path.module}/templates/node-user-data.sh.tftpl", merge(local.node_user_data_vars, {
    playbook   = "aws-worker.yml"
    extra_vars = jsonencode(local.node_extra_vars)
  })))

  metadata_options {
    http_endpoint               = local.metadata_options.http_endpoint
    http_tokens                 = local.metadata_options.http_tokens
    http_put_response_hop_limit = local.metadata_options.http_put_response_hop_limit
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
        Name = "${local.name}-worker"
        Role = "worker"
      })
    }
  }

  tags = {
    Name = "${local.name}-worker"
  }

  # user-data 는 첫 부팅에만 실행되므로 묶음 업로드 · 권한이 먼저 있어야 한다
  depends_on = [
    aws_s3_object.ansible,
    aws_iam_role_policy.worker_bootstrap,
  ]
}

resource "aws_autoscaling_group" "worker" {
  name                = "${local.name}-worker"
  vpc_zone_identifier = local.network.subnet_ids.worker
  desired_capacity    = var.worker_desired_capacity
  min_size            = var.worker_min_size
  max_size            = var.worker_max_size

  health_check_type         = "EC2"
  health_check_grace_period = 300

  # 시작 템플릿이 바뀌어도 기존 워커는 그대로 두고 새로 뜨는 인스턴스부터 반영한다
  launch_template {
    id      = aws_launch_template.worker.id
    version = aws_launch_template.worker.latest_version
  }

  # default_tags 는 ASG 에 붙지 않는다. 인스턴스 태그는 시작 템플릿이 붙이므로 전파하지 않는다
  dynamic "tag" {
    for_each = merge(data.aws_default_tags.this.tags, { Name = "${local.name}-worker" })

    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = false
    }
  }
}
