# 결제 내부 NLB 와 VPC Endpoint Service. 메인 VPC 는 71-payment-link 의 Interface Endpoint 로만 붙는다.

resource "aws_lb" "app" {
  name               = "${local.name}-app"
  internal           = true
  load_balancer_type = "network"
  subnets            = local.network.subnet_ids.lb
  security_groups    = [local.sg_ids.payment_nlb]

  # PrivateLink 트래픽에는 SG 인바운드 규칙을 적용하지 않는다. payment_nlb 에는 인바운드 규칙이 없으므로
  # 결제 VPC 안의 다른 주체는 NLB 에 붙지 못하고, PrivateLink 만 통과한다 (30-security sg-payment.tf).
  # PrivateLink 로 들어오는 쪽은 Endpoint Service 허용 주체와 메인 쪽 엔드포인트 SG(M13)가 제한한다
  enforce_security_group_inbound_rules_on_private_link_traffic = "off"

  # 결제 서버가 1대여도 메인 쪽 엔드포인트 AZ a · b 모두에서 도달한다
  enable_cross_zone_load_balancing = true

  tags = {
    Name = "${local.name}-app"
  }
}

resource "aws_lb_target_group" "app" {
  name        = "${local.name}-app"
  vpc_id      = local.network.vpc_id
  port        = var.grpc_port
  protocol    = "TCP"
  target_type = "instance"

  # 출처를 NLB IP 로 둬 payment_app SG 가 payment_nlb SG 를 참조한다 (P1 · P2).
  # PrivateLink 트래픽은 어차피 메인 쪽 IP 가 보존되지 않는다
  preserve_client_ip = false

  # 매일 destroy 시간 · 배포 drain 시간을 줄인다. 진행 중 gRPC 호출은 이 시간 안에 끝난다
  deregistration_delay = 30

  # drain 이 끝나면 남은 연결(gRPC 는 연결을 오래 유지)을 끊어 클라이언트가 다른 서버로 다시 연결하게 한다.
  # 끄면 Standby 뒤 컨테이너를 내릴 때 그 연결의 요청이 실패한다 (payment-deploy.sh)
  connection_termination = true

  # payment-service 의 HTTP 헬스체크 (GET /health). 프로세스 생존만 보고 DB 는 확인하지 않는다 (libs/common health)
  health_check {
    protocol            = "HTTP"
    port                = tostring(var.health_port)
    path                = "/health"
    matcher             = "200"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Name = "${local.name}-app"
  }
}

resource "aws_lb_listener" "app" {
  load_balancer_arn = aws_lb.app.arn
  port              = var.grpc_port
  protocol          = "TCP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_autoscaling_attachment" "app" {
  autoscaling_group_name = aws_autoscaling_group.app.name
  lb_target_group_arn    = aws_lb_target_group.app.arn
}

# 연결 요청은 허용 주체만 할 수 있고, 허용 주체의 요청은 자동 수락한다.
# 공유 계정이라 계정 전체(root) 대신 이 스택을 apply 하는 주체만 허용한다 (71 도 같은 주체가 apply).
# 계정 ID 가 든 ARN 은 plan 에 찍히므로 로그는 로컬에만 둔다
resource "aws_vpc_endpoint_service" "app" {
  network_load_balancer_arns = [aws_lb.app.arn]
  acceptance_required        = false
  allowed_principals         = [data.aws_iam_session_context.current.issuer_arn]
  supported_ip_address_types = ["ipv4"]

  tags = {
    Name = "${local.name}-app"
  }
}
