# 컨트롤 플레인 3대. AZ 마다 역할(a = init, b · c = join) 이 달라 ASG 대신 AZ 별 인스턴스로 둔다.

resource "aws_instance" "cp" {
  for_each = local.cp_subnet_ids

  ami                    = data.aws_ami.ubuntu.id
  instance_type          = var.control_plane_instance_type
  subnet_id              = each.value
  vpc_security_group_ids = [local.sg_ids.main_cp]
  iam_instance_profile   = aws_iam_instance_profile.node["cp"].name

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

  lifecycle {
    # 최신 AMI 가 나와도 실행 중인 CP 를 교체하지 않는다 (매일 재생성 때 반영)
    ignore_changes = [ami]
  }
}
