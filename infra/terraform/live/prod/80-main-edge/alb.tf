# 퍼블릭 ALB → Traefik web 엔트리포인트.
#
#   eks  Traefik 파드 IP:8000 (ip 타입, 72 의 AWS Load Balancer Controller TargetGroupBinding 이 등록)
#
# 70 kubeadm 워커 Target Group 과 가중치(kubeadm · eks)는 EKS 전환(LDP-202) 후 제거했다.

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
    bucket  = var.log_bucket_name
    prefix  = "alb"
    enabled = true
  }

  tags = {
    Name = "${local.name}-alb"
  }
}

# 72 EKS Traefik 파드. 대상 등록은 TargetGroupBinding(클러스터 안)이 하고 Terraform 은 TG 만 만든다.
# 대상이 없으면 UnHealthyHostCount 지표도 없어 90 알람은 울리지 않는다
resource "aws_lb_target_group" "eks" {
  name        = "${local.name}-eks"
  vpc_id      = local.network.vpc_id
  port        = var.traefik_container_port
  protocol    = "HTTP"
  target_type = "ip"

  # 매일 destroy · 파드 교체 시간을 줄인다. API 요청은 짧다
  deregistration_delay = 30

  # Traefik 자체 상태(/ping). ip 타입이라 traffic-port 가 파드의 web 포트다
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
    Name = "${local.name}-eks"
  }
}

# Target Group 목록 (키 = 클러스터, output target_group_arn_suffixes → 90 TG 별 unhealthy 알람)
locals {
  target_groups = {
    eks = aws_lb_target_group.eks
  }
}

# 인증서 없음: 80 → Target Group. 인증서 있음: 80 → 443 리다이렉트
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = local.https_enabled ? "redirect" : "forward"
    target_group_arn = local.https_enabled ? null : aws_lb_target_group.eks.arn

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
    target_group_arn = aws_lb_target_group.eks.arn
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

# Grafana (gitops kube-prometheus-stack Ingress). 접속 제한은 WAF grafana-ip-allowlist
resource "aws_route53_record" "grafana" {
  count = local.zone_enabled ? 1 : 0

  zone_id = local.zone_id
  name    = "${var.grafana_subdomain}.${local.domain_name}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
