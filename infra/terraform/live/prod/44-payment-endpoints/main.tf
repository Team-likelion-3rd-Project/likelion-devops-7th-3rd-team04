# Payment VPC 의 AWS API 엔드포인트. 결제 서버가 NAT 를 거치지 않고 AWS API 를 쓰게 한다.
#
#   결제 앱 → 인터페이스 엔드포인트 ENI(app 서브넷) 443   SG: 30-security payment_app → payment_vpce (P4)
#   결제 앱 → S3 게이트웨이 엔드포인트(20-network)        라우트 테이블의 prefix list 경로, 정책만 이 스택이 붙인다
#
# 인터페이스 엔드포인트는 SG 가 필요하고 SG 는 30-security 에서만 만들므로 20-network 가 아닌 이 스택에 둔다.
# 프라이빗 DNS 를 켜므로 결제 앱은 기본 엔드포인트 주소(sqs.us-east-1.amazonaws.com 등)를 그대로 쓴다.
# DNS Firewall(20-network) 은 *.amazonaws.com 을 허용하므로 엔드포인트 이름 해석이 막히지 않는다.

locals {
  name = "${var.project}-payment"
}

# 인터페이스 엔드포인트 정책: 우리 계정 IAM 주체만 엔드포인트를 쓸 수 있다.
# 엔드포인트 트래픽은 NFW · DNS Firewall 을 거치지 않으므로, 기본 정책(전체 허용)이면
# 다른 계정 자격 증명으로 다른 계정 큐 · Secret · 로그 그룹에 데이터를 보내는 유출 경로가 된다.
# 리소스 쪽 조건(aws:ResourceAccount)은 SSM 계열(Session Manager)이 리소스 없는 API 를 써서 막힐 수 있어 넣지 않는다 (배포 후 과제).
data "aws_iam_policy_document" "interface_endpoint" {
  statement {
    sid       = "AllowOwnAccountPrincipals"
    effect    = "Allow"
    actions   = ["*"]
    resources = ["*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:PrincipalAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = var.interface_endpoints

  vpc_id              = var.vpc_id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = var.app_subnet_ids
  security_group_ids  = [var.sg_ids["payment_vpce"]]
  private_dns_enabled = true
  policy              = data.aws_iam_policy_document.interface_endpoint.json

  tags = {
    Name = "${local.name}-${each.key}"
  }
}
