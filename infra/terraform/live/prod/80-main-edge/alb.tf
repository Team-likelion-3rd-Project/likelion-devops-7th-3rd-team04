# 퍼블릭 ALB → 워커 ASG NodePort 30080 (Traefik web 엔트리포인트).

resource "aws_lb" "main" {
  name               = "${local.name}-alb"
  internal           = false
  load_balancer_type = "application"
  subnets            = local.network.subnet_ids.public
  security_groups    = [local.sg_ids.main_alb]

  # 매일 destroy 하므로 삭제 보호는 끈다
  enable_deletion_protection = false

  # 형식이 잘못된 헤더(HTTP 요청 스머글링 등에 쓰임)는 백엔드로 넘기지 않는다
  drop_invalid_header_fields = true

  # 10-global 로그 버킷 정책이 alb/AWSLogs/<계정 ID>/ 경로에만 쓰기를 허용한다
  access_logs {
    bucket  = local.global.log_bucket_name
    prefix  = "alb"
    enabled = true
  }

  tags = {
    Name = "${local.name}-alb"
  }
}

resource "aws_lb_target_group" "worker" {
  name        = "${local.name}-worker"
  vpc_id      = local.network.vpc_id
  port        = 30080
  protocol    = "HTTP"
  target_type = "instance"

  # 매일 destroy · 워커 교체 시간을 줄인다. API 요청은 짧다
  deregistration_delay = 30

  # Traefik 자체 상태(/ping). Traefik 은 externalTrafficPolicy Cluster 라 어느 워커로 와도 응답하므로
  # 테스트 백엔드(whoami) 유무와 관계없이 워커 전부 healthy 다
  health_check {
    protocol            = "HTTP"
    path                = "/ping"
    port                = "traffic-port"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = {
    Name = "${local.name}-worker"
  }
}

# 연결 리소스는 사용하는 쪽 스택에 둔다. ASG 가 새로 띄운 워커도 자동 등록된다
resource "aws_autoscaling_attachment" "worker" {
  autoscaling_group_name = data.terraform_remote_state.main_cluster.outputs.worker_asg_name
  lb_target_group_arn    = aws_lb_target_group.worker.arn
}

# 인증서 없음: 80 → 워커. 인증서 있음: 80 → 443 리다이렉트
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.https_enabled ? "redirect" : "forward"
    target_group_arn = local.https_enabled ? null : aws_lb_target_group.worker.arn

    dynamic "redirect" {
      for_each = local.https_enabled ? [1] : []

      content {
        protocol    = "HTTPS"
        port        = "443"
        status_code = "HTTP_301"
      }
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.https_enabled ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = local.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.worker.arn
  }
}

resource "aws_route53_record" "api" {
  count = local.zone_enabled ? 1 : 0

  zone_id = local.zone_id
  name    = "${var.api_subdomain}.${local.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
