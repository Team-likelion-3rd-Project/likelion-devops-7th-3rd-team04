# 컨트롤 플레인 3대. AZ 마다 역할(a = init, b · c = join) 이 달라 ASG 대신 AZ 별 인스턴스로 둔다.
# user-data 가 bootstrap.tf 의 Ansible 묶음 · 파라미터로 kubeadm init / join --control-plane 을 한다.

resource "aws_instance" "cp" {
  for_each = local.cp_subnet_ids

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.control_plane_instance_type
  subnet_id              = each.value
  vpc_security_group_ids = [local.sg_ids.main_cp]
  iam_instance_profile   = aws_iam_instance_profile.node["cp"].name

  user_data = templatefile("${path.module}/templates/node-user-data.sh.tftpl", merge(local.node_user_data_vars, {
    playbook = "aws-control-plane.yml"
    extra_vars = jsonencode(merge(local.node_extra_vars, {
      k8s_cp_role = each.key == "a" ? "init" : "join"
    }))
  }))

  metadata_options {
    http_endpoint               = local.metadata_options.http_endpoint
    http_tokens                 = local.metadata_options.http_tokens
    http_put_response_hop_limit = local.metadata_options.http_put_response_hop_limit
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_size
    encrypted   = true
  }

  tags = {
    Name = "${local.name}-cp-${each.key}"
    Role = "control-plane"
  }

  volume_tags = {
    Name = "${local.name}-cp-${each.key}"
  }

  # user-data 는 첫 부팅에만 실행되므로 묶음 업로드 · 권한이 먼저 있어야 한다
  depends_on = [
    aws_s3_object.ansible,
    aws_iam_role_policy.cp_bootstrap,
  ]

  lifecycle {
    # 최신 AMI 가 나오거나 user-data 를 고쳐도 실행 중인 CP 를 교체 · 재시작하지 않는다 (매일 재생성 때 반영)
    ignore_changes = [ami, user_data]
  }
}
