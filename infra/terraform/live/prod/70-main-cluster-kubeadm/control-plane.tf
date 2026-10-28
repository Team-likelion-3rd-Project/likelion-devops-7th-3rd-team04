# 컨트롤 플레인 3대. AZ 마다 역할(a = init, b · c = join) 이 달라 AZ 별 시작 템플릿 + ASG(1대 고정) 로 둔다.
# user-data 가 bootstrap.tf 의 Ansible 묶음 · 파라미터로 kubeadm init / join --control-plane 을 한다.
#
# CP 가 사라지면 ASG 가 같은 AZ 에 새로 띄우고, 새 CP 는 join 한다 (CA cert hash 가 이미 있으면 CP-a 도 join).
# 사라진 CP 의 etcd 멤버 제거 · kubeadm-certs Secret 재업로드는 남은 CP 의 reconcile timer, Node 삭제는 CCM 이 한다 (README 6절).

resource "aws_launch_template" "cp" {
  for_each = local.cp_subnet_ids

  name                   = "${local.name}-cp-${each.key}"
  image_id               = data.aws_ami.ubuntu.id
  instance_type          = var.control_plane_instance_type
  vpc_security_group_ids = [local.sg_ids.main_cp]

  credit_specification {
    cpu_credits = local.cpu_credits
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.node["cp"].name
  }

  user_data = base64encode(templatefile("${path.module}/templates/node-user-data.sh.tftpl", merge(local.node_user_data_vars, {
    playbook          = "aws-control-plane.yml"
    report_asg_health = true
    extra_vars = jsonencode(merge(local.node_extra_vars, {
      k8s_cp_role                = each.key == "a" ? "init" : "join"
      nth_queue_url              = aws_sqs_queue.nth.url
      k8s_service_account_issuer = var.oidc_issuer_url
      oidc_bucket_name           = var.oidc_bucket_name
    }))
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
      tags = merge(data.aws_default_tags.this.tags, local.cluster_tags, {
        Name = "${local.name}-cp-${each.key}"
        Role = "control-plane"
      })
    }
  }

  tags = {
    Name = "${local.name}-cp-${each.key}"
  }

  # user-data 는 첫 부팅에만 실행되므로 묶음 업로드 · 권한이 먼저 있어야 한다
  depends_on = [
    aws_s3_object.ansible,
    aws_iam_role_policy.cp_bootstrap,
  ]
}

resource "aws_autoscaling_group" "cp" {
  for_each = local.cp_subnet_ids

  name                = "${local.name}-cp-${each.key}"
  vpc_zone_identifier = [each.value]
  desired_capacity    = 1
  min_size            = 1
  max_size            = 1

  # EC2 상태만 본다. apiserver 헬스체크(ELB) 를 쓰면 etcd 가 잠시 불안정할 때 CP 3대가 동시에 교체되어
  # etcd 데이터가 모두 사라질 수 있다. 응답하지 않는 apiserver 는 내부 NLB 가 트래픽에서 뺀다.
  # 부트스트랩(join) 실패는 user-data 가 Unhealthy 로 보고한다
  health_check_type         = "EC2"
  health_check_grace_period = 300

  # 시작 템플릿이 바뀌어도(최신 AMI, user-data) 실행 중인 CP 는 교체하지 않는다 (매일 재생성 때 반영)
  launch_template {
    id      = aws_launch_template.cp[each.key].id
    version = aws_launch_template.cp[each.key].latest_version
  }

  # default_tags 는 ASG 에 붙지 않는다. 인스턴스 태그는 시작 템플릿이 붙이므로 전파하지 않는다
  dynamic "tag" {
    for_each = merge(data.aws_default_tags.this.tags, { Name = "${local.name}-cp-${each.key}" })

    content {
      key                 = tag.key
      value               = tag.value
      propagate_at_launch = false
    }
  }
}
