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
#   hotel-service     13-frontend image_writer_role_name (사진 버킷 정책의 쓰기 허용)
#   seed              13-frontend image_seed_role_name (사진 버킷 정책의 쓰기 허용)
# ESO 가 읽는 Secret 리소스 정책도 Role 이름으로 허용한다: 41-main-data · 12-secrets 의 external_secrets_role_name

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
    hotel-service = {
      description     = "hotel-service (room image presigned upload, delete)"
      namespace       = "backend"
      service_account = "hotel-service"
    }
    # backend 차트 seed Job (seed.enabled 일 때 SA 생성)
    seed = {
      description     = "seed Job (seed room image upload)"
      namespace       = "backend"
      service_account = "seed"
    }
    # 챗봇 (LDP-143). Vertex AI(GCP) 인증은 IRSA 가 아니라 14-gcp-llm Workload Identity Federation
    chat-bot-service = {
      description     = "chat-bot-service (chat session, message tables)"
      namespace       = "backend"
      service_account = "chat-bot-service"
    }
    llm-service = {
      description     = "llm-service (RAG vector query)"
      namespace       = "backend"
      service_account = "llm-service"
    }
    # backend 차트 RAG 적재 Job (llmIngest.enabled 일 때 SA 생성)
    llm-ingest = {
      description     = "llm-ingest Job (RAG vector put)"
      namespace       = "backend"
      service_account = "llm-ingest"
    }
    # 클러스터 로그 수집 DaemonSet (LDP-144, gitops fluent-bit)
    fluent-bit = {
      description     = "Fluent Bit (cluster log groups, log bucket app-logs/main-cluster/)"
      namespace       = "fluent-bit"
      service_account = "fluent-bit"
    }
  }

  # 15-chatbot-vectors 인덱스 (s3vectors 리소스 ARN 형식 bucket/<버킷>/index/<인덱스>)
  vector_index_arn = "arn:${data.aws_partition.current.partition}:s3vectors:${var.region}:${data.aws_caller_identity.current.account_id}:bucket/${var.vector_bucket_name}/index/${var.vector_index_name}"
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

# ESO: 41-main-data 의 Secret(접속 정보 · 앱 서명 키)과 12-secrets 의 시드 관리자 계정 값 조회만.
# Secret ARN 끝의 무작위 6자는 ?????? 로 맞춘다
data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid     = "GetAppSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      for name in concat(values(var.secret_names), [var.seed_admin_secret_name]) :
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

# hotel-service: 13-frontend 사진 버킷의 room-types/* 만 (room-image.storage.ts).
#   PutObject     Presigned PUT 서명 (브라우저가 이 Role 권한으로 올림)
#   GetObject     HeadObject(업로드 확인) — 보기는 CloudFront 고정 URL 이라 서명하지 않음
#   DeleteObject  DeleteObjects(사진 교체 · 객실 삭제)
data "aws_iam_policy_document" "hotel_service" {
  statement {
    sid       = "RoomImages"
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.image_bucket_name}/room-types/*"]
  }
}

resource "aws_iam_role_policy" "hotel_service" {
  name   = "room-images"
  role   = aws_iam_role.irsa["hotel-service"].id
  policy = data.aws_iam_policy_document.hotel_service.json
}

# seed: 시드 사진을 고정 키(room-types/<객실 종류 ID>/seed-<파일>)로 올리기만 (backend/scripts/seed.ts).
#   이미 있는지는 조건부 쓰기(If-None-Match, 있으면 412)로 판단해 HeadObject(GetObject) · ListBucket 이 필요 없다
data "aws_iam_policy_document" "seed" {
  statement {
    sid       = "SeedRoomImages"
    actions   = ["s3:PutObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.image_bucket_name}/room-types/*"]
  }
}

resource "aws_iam_role_policy" "seed" {
  name   = "seed-room-images"
  role   = aws_iam_role.irsa["seed"].id
  policy = data.aws_iam_policy_document.seed.json
}

# chat-bot-service: 41-main-data 대화 테이블 두 개만 (session.service.ts · message.service.ts 는 PutCommand · QueryCommand 만 사용).
#   세션은 userId-index(GSI) 로 조회하므로 인덱스 ARN 도 넣는다
data "aws_iam_policy_document" "chat_bot_service" {
  statement {
    sid     = "ChatTables"
    actions = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = flatten([
      for name in values(var.dynamodb_table_names) : [
        "arn:${data.aws_partition.current.partition}:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${name}",
        "arn:${data.aws_partition.current.partition}:dynamodb:${var.region}:${data.aws_caller_identity.current.account_id}:table/${name}/index/*",
      ]
    ])
  }
}

resource "aws_iam_role_policy" "chat_bot_service" {
  name   = "chat-tables"
  role   = aws_iam_role.irsa["chat-bot-service"].id
  policy = data.aws_iam_policy_document.chat_bot_service.json
}

# llm-service: RAG 인덱스 조회만 (vector_store.py query_vectors, returnMetadata 라 GetVectors 도 필요)
data "aws_iam_policy_document" "llm_service" {
  statement {
    sid       = "QueryRagIndex"
    actions   = ["s3vectors:QueryVectors", "s3vectors:GetVectors"]
    resources = [local.vector_index_arn]
  }
}

resource "aws_iam_role_policy" "llm_service" {
  name   = "rag-query"
  role   = aws_iam_role.irsa["llm-service"].id
  policy = data.aws_iam_policy_document.llm_service.json
}

# llm-ingest: RAG 인덱스 쓰기만 (scripts/ingest.py put_vectors, 문서 id 가 key 라 덮어쓰기)
data "aws_iam_policy_document" "llm_ingest" {
  statement {
    sid       = "PutRagIndex"
    actions   = ["s3vectors:PutVectors"]
    resources = [local.vector_index_arn]
  }
}

resource "aws_iam_role_policy" "llm_ingest" {
  name   = "rag-put"
  role   = aws_iam_role.irsa["llm-ingest"].id
  policy = data.aws_iam_policy_document.llm_ingest.json
}

# fluent-bit: 21-observability-base 의 클러스터 로그 그룹에 쓰기 + 로그 버킷 app-logs/main-cluster/ 올리기만.
#   CreateLogStream · PutLogEvents  cloudwatch_logs 출력 (그룹은 Terraform 이 만들어 CreateLogGroup 없음, 스트림 ARN 은 그룹 ARN:*)
#   PutObject                       s3 출력 (use_put_object, 멀티파트 미사용). 결제 서버 로그 등 다른 app-logs/ 경로는 쓸 수 없다
data "aws_iam_policy_document" "fluent_bit" {
  statement {
    sid     = "ClusterLogGroups"
    actions = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [
      for name in values(var.cluster_log_group_names) :
      "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:${name}:*"
    ]
  }

  statement {
    sid       = "AppLogsMainCluster"
    actions   = ["s3:PutObject"]
    resources = ["arn:${data.aws_partition.current.partition}:s3:::${var.log_bucket_name}/app-logs/main-cluster/*"]
  }
}

resource "aws_iam_role_policy" "fluent_bit" {
  name   = "cluster-logs"
  role   = aws_iam_role.irsa["fluent-bit"].id
  policy = data.aws_iam_policy_document.fluent_bit.json
}
