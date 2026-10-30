# 결제 서버 ASG (app 서브넷 a · b). 새로 뜬 인스턴스(최초 · 교체 · 확장)는 user-data 로 부트스트랩하고,
# 같은 pull agent(templates/payment-deploy.sh) 로 Parameter Store 의 현재 release 를 배포한다.
# NLB Target Group 헬스체크(GET /health)가 실패하면 ASG 가 교체한다.
#
# 기본 2대(AZ a · b). 배포는 서버마다 순서대로 한다: 첫 AZ 가 먼저, 다음 AZ 는 deploy_stagger_seconds 뒤.
# 각 서버는 배포 동안 자기 자신을 Standby 로 보내 NLB 에서 빼므로(drain) 다른 서버가 요청을 받는다.
# 대수와 관계없이 NLB cross-zone 으로 메인 쪽 엔드포인트(AZ a · b) 모두에서 도달한다.

# provider default_tags 는 시작 템플릿으로 띄운 인스턴스 · 볼륨에 붙지 않아 직접 넣는다
data "aws_default_tags" "this" {}

locals {
  asg_name = "${local.name}-app"

  # RDS CA 번들 원본은 gitops backend-secrets 차트와 같은 파일 (메인 클러스터 파드도 이 파일을 쓴다)
  rds_ca_bundle = file("${path.module}/../../../../gitops/prod/backend-secrets/chart/files/us-east-1-bundle.pem")

  # /etc/payment-deploy/config.env (payment-deploy.sh 가 읽는다). 비밀값 · 계정 ID 는 넣지 않는다 (agent 가 IMDS · Secrets Manager 에서 읽음)
  deploy_config = {
    REGION                    = var.region
    RELEASE_PARAMETER         = local.release_parameter
    ASG_NAME                  = local.asg_name
    APP_REPOSITORY            = "${var.project}/payment-service"
    MIGRATIONS_REPOSITORY     = "${var.project}/payment-migrations"
    PAYMENT_DB_SECRET_ID      = var.payment_db_secret_name
    TOSS_SECRET_ID            = local.toss_secret_name
    PAYMENT_RESULT_QUEUE_NAME = var.queue_names.payment_result
    PG_MOCK_SERVICE_URL       = "http://${cidrhost(local.network.app_static_cidr, var.pg_mock_private_ip_hostnum)}:${var.pg_mock_port}"
    GRPC_PORT                 = var.grpc_port
    HEALTH_PORT               = var.health_port
    METRICS_PORT              = var.metrics_port
    RDS_CA_PATH               = "/etc/payment-deploy/rds-ca-bundle.pem"
    APP_LOG_GROUP             = aws_cloudwatch_log_group.app.name
    DEPLOY_LOG_GROUP          = aws_cloudwatch_log_group.deploy.name
    DEPLOY_TOPIC_NAME         = var.deploy_topic_name
    # AZ 접미사 순서(a b). 앞선 AZ 가 먼저 배포한다
    AZ_ORDER        = join(" ", sort(keys(local.network.subnet_ids_by_az.app)))
    STAGGER_SECONDS = var.deploy_stagger_seconds
    HEALTH_TIMEOUT  = var.deploy_health_timeout
    STANDBY_TIMEOUT = 180
  }

  # /etc/payment-metrics/config.env (payment-metrics.sh 가 읽는다, LDP-181). 비밀값 · 계정 ID 없음
  metrics_config = {
    EXPORTER_SECRET_ID            = var.payment_db_exporter_secret_name
    EXPORTER_MAX_USER_CONNECTIONS = var.db_exporter_max_user_connections
    ALLOY_REPOSITORY              = data.aws_ecr_image.alloy.repository_name
    ALLOY_DIGEST                  = data.aws_ecr_image.alloy.image_digest
    ALLOY_PORT                    = var.alloy_port
    DATA_DIR                      = "/var/lib/payment-metrics/alloy"
  }
}

locals {
  # 스크립트 · CA 를 그대로 넣으면 user-data 한도(16KB, gzip 후 크기)를 넘어 gzip 으로 넣는다.
  # 지표 수집기(LDP-181)까지 넣어 gzip 약 14KB — 더 늘리면 아래 precondition 이 막는다
  user_data = base64gzip(templatefile("${path.module}/templates/user-data.sh.tftpl", {
    config         = local.deploy_config
    rds_ca_path    = local.deploy_config.RDS_CA_PATH
    rds_ca_bundle  = trimspace(local.rds_ca_bundle)
    agent_script   = trimspace(file("${path.module}/templates/payment-deploy.sh"))
    metrics_config = local.metrics_config
    metrics_script = trimspace(file("${path.module}/templates/payment-metrics.sh"))
    # 주석 줄은 빼고 넣는다 (user-data 한도. 설명은 레포의 템플릿에)
    alloy_config = trimspace(replace(templatefile("${path.module}/templates/config.alloy.tftpl", {
      region           = var.region
      environment      = var.environment
      scrape_interval  = var.metrics_scrape_interval
      metrics_port     = var.metrics_port
      remote_write_url = "${var.payment_metrics_endpoint}api/v1/remote_write"
    }), "/(?m)^[ \t]*//.*\n/", ""))
  }))
}

# 11-registry 미러의 Alloy 이미지 (버전당 1회 복사, README 결제 서버 지표 절). 없으면 plan 이 여기서 실패한다.
# digest 로 받으므로 같은 태그를 다시 올려도(IMMUTABLE 이라 불가) 서버마다 다른 이미지가 뜨지 않는다
data "aws_ecr_image" "alloy" {
  repository_name = "${var.project}/alloy"
  image_tag       = var.alloy_version
}

resource "aws_launch_template" "app" {
  name                   = "${local.name}-app"
  image_id               = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  vpc_security_group_ids = [local.sg_ids.payment_app]

  iam_instance_profile {
    name = aws_iam_instance_profile.app.name
  }

  user_data = local.user_data

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

  lifecycle {
    # base64gzip 결과의 3/4 = gzip 크기. EC2 한도는 인코딩 전 16384 바이트
    precondition {
      condition     = length(local.user_data) * 3 / 4 <= 16384
      error_message = "user-data(gzip)가 16KB 를 넘습니다. 템플릿 · 스크립트를 줄여야 합니다."
    }
  }

  # user-data 는 첫 부팅에만 실행되므로 권한이 먼저 있어야 한다
  depends_on = [aws_iam_role_policy.app]
}

resource "aws_autoscaling_group" "app" {
  name                = local.asg_name
  vpc_zone_identifier = local.network.subnet_ids.app
  desired_capacity    = var.desired_capacity
  min_size            = var.min_size
  max_size            = var.max_size

  # 부팅 · 첫 배포(docker 설치 · 이미지 pull · Flyway) 동안은 판단하지 않는다.
  # 이후 배포는 Standby 상태에서 하므로 헬스체크 대상이 아니다 (payment-deploy.sh)
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
