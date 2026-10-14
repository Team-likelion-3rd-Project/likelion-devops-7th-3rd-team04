# kube-apiserver 내부 NLB. kubeadm controlPlaneEndpoint 와 kubelet · 파드의 API 서버 주소로 쓴다.

resource "aws_lb" "apiserver" {
  name               = "${local.name}-apiserver"
  internal           = true
  load_balancer_type = "network"
  subnets            = values(local.cp_subnet_ids)
  security_groups    = [local.sg_ids.main_internal_nlb]

  # AZ 의 CP 가 내려가도 그 AZ 의 NLB 노드가 다른 AZ CP 로 보낸다
  enable_cross_zone_load_balancing = true

  tags = {
    Name = "${local.name}-apiserver"
  }

  lifecycle {
    precondition {
      condition     = length(local.cp_subnet_ids) == 3 && local.sg_ids.main_cp != null && local.sg_ids.main_internal_nlb != null
      error_message = "20-network enable_control_plane_subnets, 30-security enable_control_plane 이 true 여야 합니다."
    }
  }
}

resource "aws_lb_target_group" "apiserver" {
  name        = "${local.name}-apiserver"
  vpc_id      = local.network.vpc_id
  port        = 6443
  protocol    = "TCP"
  target_type = "instance"

  # CP 가 NLB 를 거쳐 자기 자신에게 붙을 때(헤어핀) 타임아웃 나지 않도록 보존을 끈다.
  # 출처가 NLB IP 가 되어 main-cp SG 가 main-internal-nlb SG 를 참조한다 (보안 그룹 설계 M5)
  preserve_client_ip = false

  # 매일 destroy 시간을 줄인다. kube-apiserver 요청은 대부분 짧고 watch 는 클라이언트가 다시 붙는다
  deregistration_delay = 30

  # /readyz 는 익명 접근 허용(system:public-info-viewer). NLB 는 HTTPS 헬스체크 인증서를 검증하지 않는다
  health_check {
    protocol            = "HTTPS"
    path                = "/readyz"
    port                = "traffic-port"
    interval            = 10
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Name = "${local.name}-apiserver"
  }
}

resource "aws_lb_listener" "apiserver" {
  load_balancer_arn = aws_lb.apiserver.arn
  port              = 6443
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.apiserver.arn
  }
}

resource "aws_lb_target_group_attachment" "apiserver" {
  for_each = aws_instance.cp

  target_group_arn = aws_lb_target_group.apiserver.arn
  target_id        = each.value.id
  port             = 6443
}
