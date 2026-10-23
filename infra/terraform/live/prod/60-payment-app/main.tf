# Payment VPC 결제 서버와 PrivateLink 제공 쪽(NLB · Endpoint Service).
#
#   메인 파드 → 71-payment-link 엔드포인트(payment.team04-hotel.internal:3004)
#     → Endpoint Service → 결제 NLB(lb 서브넷, TCP 3004) → 결제 서버(app 서브넷, ASG) 3004
#
#   결제 서버 → RDS(42) 3306, 인터페이스 엔드포인트(44) · S3 게이트웨이(ECR 레이어 · dnf) 443, 토스 API(NAT, NFW 허용 목록)
#   결제 서버 → 메인 VPC 는 경로가 없다 (Peering · TGW 없음, 결과는 SQS 로 보냄)
#
# 결제 서버는 Amazon Linux 2023(Graviton). 패키지 저장소가 S3 라 S3 게이트웨이 엔드포인트로 받고, NAT 로는 토스만 나간다.
# 배포는 결제 서버 안의 pull agent 가 한다 (server.tf, templates/payment-deploy.sh, README 결제 서버 배포 절).
#   gitops envs/prod/payment/values.yaml merge → GitHub Actions(OIDC) → Parameter Store release → agent(1분) → ECR pull · Flyway · 교체
#   GitHub · Runner 는 결제 서버에 명령을 실행할 수 없다 (agent 가 읽기만 한다).
# 접속은 SSM Session Manager 로 한다 (22 포트, 키 페어 없음).

data "aws_ssm_parameter" "al2023_ami" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64"
}

data "aws_ami" "al2023" {
  owners = ["amazon"]

  filter {
    name   = "image-id"
    values = [nonsensitive(data.aws_ssm_parameter.al2023_ami.value)]
  }
}

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  name = "${var.project}-payment"

  network = var.payment_network
  sg_ids  = var.sg_ids

  arn_prefix    = "arn:${data.aws_partition.current.partition}"
  account_id    = data.aws_caller_identity.current.account_id
  secret_prefix = "${var.project}/${var.environment}"

  # 12-secrets 의 토스 시크릿 키 Secret (고정 이름, 스택 의존 없음)
  toss_secret_name = "${local.secret_prefix}/toss-payments"

  # 11-registry 의 결제 서버 release 파라미터 {image_tag, env} (같은 이름 규칙, 스택 의존 없음)
  release_parameter = "/${var.project}/${var.environment}/payment/release"

  # IMDSv2 강제, hop limit 1. 컨테이너는 host 네트워크로 띄워 인스턴스 Role 자격 증명을 받는다 (payment-deploy.sh)
  metadata_options = {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
}
