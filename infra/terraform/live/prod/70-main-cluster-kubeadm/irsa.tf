# 파드용 IRSA Role. 10-global 의 OIDC 공급자(자체 IRSA)를 신뢰한다.
#
#   kube-apiserver --service-account-issuer = var.oidc_issuer_url  (CP extra vars, Ansible kubeadm 템플릿)
#   keys.json(SA 서명 공개키)                CP-a 가 init 직후 OIDC 버킷에 올린다 (iam.tf PutOidcKeys)
#   ns/SA → Role 매핑                        pod-identity-webhook ConfigMap (infra/gitops/prod/pod-identity-webhook)
#
# 신뢰 정책은 sub(네임스페이스 · ServiceAccount) 와 aud 를 정확히 비교해 다른 SA 의 위임을 거부한다.
# 리소스 정책이 Role 이름으로 허용하므로 이름(키)을 바꾸면 그쪽 변수도 바꾼다.
#   external-secrets  41-main-data external_secrets_role_name (Secret 리소스 정책)
#   booking-service   43-messaging booking_role_name (큐 정책)

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  oidc_provider     = trimprefix(var.oidc_issuer_url, "https://")
  oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"

  irsa_roles = {
    external-secrets = {
      description     = "External Secrets Operator (Secrets Manager read)"
      namespace       = "external-secrets"
      service_account = "external-secrets"
    }
    # SA 는 backend 차트가 서비스별로 만든다 (default SA 에 매핑하면 backend 파드 전부가 큐 권한을 받는다)
    booking-service = {
      description     = "booking-service (payment result queue receive)"
      namespace       = "backend"
      service_account = "booking-service"
    }
  }
}

data "aws_iam_policy_document" "irsa_assume" {
  for_each = local.irsa_roles

  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider}:sub"
      values   = ["system:serviceaccount:${each.value.namespace}:${each.value.service_account}"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.oidc_provider}:aud"
      values   = ["sts.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "irsa" {
  for_each = local.irsa_roles

  name               = "${var.project}-${each.key}"
  description        = each.value.description
  assume_role_policy = data.aws_iam_policy_document.irsa_assume[each.key].json
}

# ESO: 41-main-data 의 접속 정보 Secret 값 조회만. Secret ARN 끝의 무작위 6자는 ?????? 로 맞춘다
data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid     = "GetAppSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      for name in values(var.secret_names) :
      "arn:${data.aws_partition.current.partition}:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${name}-??????"
    ]
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "secrets-read"
  role   = aws_iam_role.irsa["external-secrets"].id
  policy = data.aws_iam_policy_document.external_secrets.json
}

# booking-service: 43-messaging 결제 결과 큐 수신 · 삭제만 (payment-result.consumer.ts). DLQ 는 관리자만 다룬다
data "aws_iam_policy_document" "booking_service" {
  statement {
    sid       = "ConsumePaymentResult"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage"]
    resources = ["arn:${data.aws_partition.current.partition}:sqs:${var.region}:${data.aws_caller_identity.current.account_id}:${var.queue_names.payment_result}"]
  }
}

resource "aws_iam_role_policy" "booking_service" {
  name   = "payment-result-consume"
  role   = aws_iam_role.irsa["booking-service"].id
  policy = data.aws_iam_policy_document.booking_service.json
}
