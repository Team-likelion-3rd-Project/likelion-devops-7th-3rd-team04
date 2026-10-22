# Payment VPC 결제 서버와 PrivateLink 제공 쪽(NLB · Endpoint Service).
#
#   메인 파드 → 71-payment-link 엔드포인트(payment.team04-hotel.internal:3004)
#     → Endpoint Service → 결제 NLB(lb 서브넷, TCP 3004) → 결제 서버(app 서브넷, ASG) 3004
#
#   결제 서버 → RDS(42) 3306, 인터페이스 엔드포인트(44) · S3 게이트웨이(ECR 레이어 · dnf) 443, 토스 API(NAT, NFW 허용 목록)
#   결제 서버 → 메인 VPC 는 경로가 없다 (Peering · TGW 없음, 결과는 SQS 로 보냄)
#
# 결제 서버는 Amazon Linux 2023(Graviton). 패키지 저장소가 S3 라 S3 게이트웨이 엔드포인트로 받고, NAT 로는 토스만 나간다.
# 이 스택의 user-data 는 docker 설치와 검증용 리스너까지다. 실제 배포(pull agent · Flyway)는 LDP-116 에서 user-data 를 바꾼다.
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

  # IMDSv2 강제, hop limit 1. 컨테이너는 host 네트워크로 띄워야 인스턴스 Role 자격 증명을 받는다 (LDP-116)
  metadata_options = {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }
}
