# 퍼블릭 ALB → Traefik web 엔트리포인트. 클러스터별 Target Group 에 가중치로 나눈다 (var.traffic_weights).
#
#   kubeadm  워커 ASG NodePort 30080 (instance 타입, 70)
#   eks      Traefik 파드 IP:8000 (ip 타입, 72 의 AWS Load Balancer Controller TargetGroupBinding 이 등록)
#
# EKS 전환(블루/그린)은 가중치만 바꾼다: 100/0 → 90/10 → 0/100. 대상이 없는 TG 는 가중치를 0 으로 둔다
# (가중치가 있는데 대상이 없으면 그 비율만큼 503).

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

# 72 EKS Traefik 파드. 대상 등록은 TargetGroupBinding(클러스터 안)이 하고 Terraform 은 TG 만 만든다.
# 대상이 없으면 UnHealthyHostCount 지표도 없어 90 알람은 울리지 않는다
resource "aws_lb_target_group" "eks" {
  name        = "${local.name}-eks"
  vpc_id      = local.network.vpc_id
  port        = var.traefik_container_port
  protocol    = "HTTP"
  target_type = "ip"

  deregistration_delay = 30

  # worker TG 와 같은 Traefik /ping. ip 타입이라 traffic-port 가 파드의 web 포트다
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

# 연결 리소스는 사용하는 쪽 스택에 둔다. ASG 가 새로 띄운 워커도 자동 등록된다
resource "aws_autoscaling_attachment" "worker" {
  autoscaling_group_name = var.worker_asg_name
  lb_target_group_arn    = aws_lb_target_group.worker.arn
}

# 리스너가 나눠 보낼 Target Group (키 = var.traffic_weights 키)
locals {
  target_groups = {
    kubeadm = aws_lb_target_group.worker
    eks     = aws_lb_target_group.eks
  }
}

# 인증서 없음: 80 → Target Group (가중치). 인증서 있음: 80 → 443 리다이렉트
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = local.https_enabled ? "redirect" : "forward"

    dynamic "forward" {
      for_each = local.https_enabled ? [] : [1]

      content {
        dynamic "target_group" {
          for_each = local.target_groups

          content {
            arn    = target_group.value.arn
            weight = var.traffic_weights[target_group.key]
          }
        }
      }
    }

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
    type = "forward"

    forward {
      dynamic "target_group" {
        for_each = local.target_groups

        content {
          arn    = target_group.value.arn
          weight = var.traffic_weights[target_group.key]
        }
      }
    }
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
