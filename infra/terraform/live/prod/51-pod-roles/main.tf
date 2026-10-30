# 메인 클러스터 파드용 Role (LDP-200). kubeadm(70) · EKS(72) 가 같은 Role 을 쓰도록 클러스터 스택 밖에 둔다.
# Role 이 하나라 아래 리소스 정책(Role 이름으로 허용)은 클러스터가 바뀌어도 그대로다.
#
# 신뢰 정책 (Role 마다 같은 ns/SA 로 제한)
#   IRSA          70 kubeadm. 10-global 의 OIDC 공급자(자체 발급자). sub(네임스페이스 · ServiceAccount) · aud 를 정확히 비교
#                   kube-apiserver --service-account-issuer = var.oidc_issuer_url  (70 CP extra vars, Ansible kubeadm 템플릿)
#                   keys.json(SA 서명 공개키)                CP-a 가 init 직후 OIDC 버킷에 올린다 (70 iam.tf PutOidcKeys)
#                   ns/SA → Role 매핑                        pod-identity-webhook ConfigMap (infra/gitops/prod/pod-identity-webhook)
#   Pod Identity  72 EKS (var.enable_pod_identity). 세션 태그 kubernetes-namespace · kubernetes-service-account 와
#                 aws:SourceArn(클러스터 ARN)을 비교한다. ns/SA → Role 매핑은 72 의 Pod Identity Association
#
# 70 을 정리할 때는 IRSA statement 만 지운다 (10-global 자체 OIDC 와 함께).
# 리소스 정책이 Role 이름으로 허용하므로 이름(키)을 바꾸면 그쪽 변수도 바꾼다.
#   external-secrets  41-main-data external_secrets_role_name (Secret 리소스 정책)
#   booking-service   43-messaging booking_role_name (큐 정책)
#   hotel-service     13-frontend image_writer_role_name (사진 버킷 정책의 쓰기 허용)
#   seed              13-frontend image_seed_role_name (사진 버킷 정책의 쓰기 허용)
#   deploy-notify     10-global deploy_publisher_role_names (배포 토픽 정책)
#   alertmanager      10-global alert_publisher_role_names (알림 토픽 정책)
# ESO 가 읽는 Secret 리소스 정책도 Role 이름으로 허용한다: 41-main-data · 12-secrets 의 external_secrets_role_name

data "aws_caller_identity" "current" {}

data "aws_partition" "current" {}

locals {
  oidc_provider     = trimprefix(var.oidc_issuer_url, "https://")
  oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/${local.oidc_provider}"

  pod_roles = {
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
    # ArgoCD root 앱(prod-apps) 의 배포 결과 알림 hook Job. argocd 네임스페이스는 webhook 대상이 아니라
    # Job 이 토큰(aud sts.amazonaws.com)을 직접 마운트하고 AWS_ROLE_ARN 을 넣는다 (gitops root 차트 templates/deploy-notify.yaml).
    # 10-global 배포 토픽 정책이 이 Role 이름으로 발행을 허용한다 (deploy_publisher_role_names)
    deploy-notify = {
      description     = "ArgoCD deploy result notification hook"
      namespace       = "argocd"
      service_account = "deploy-notify"
    }
    # 클러스터 로그 수집 DaemonSet (LDP-144, gitops fluent-bit)
    fluent-bit = {
      description     = "Fluent Bit (cluster log groups, log bucket app-logs/main-cluster/)"
      namespace       = "fluent-bit"
      service_account = "fluent-bit"
    }
    # Prometheus 알림 (LDP-179, gitops kube-prometheus-stack). SA 이름은 그 values 의 alertmanager.serviceAccount.name.
    # 10-global 알림 토픽 정책이 이 Role 이름으로 발행을 허용한다 (alert_publisher_role_names)
    alertmanager = {
      description     = "Alertmanager (alerts topic publish)"
      namespace       = "monitoring"
      service_account = "kube-prometheus-stack-alertmanager"
    }
    # Grafana CloudWatch 데이터 소스 (LDP-180) · 결제 지표 AMP 데이터 소스 (LDP-181), gitops kube-prometheus-stack.
    # SA 이름은 그 values 의 grafana.serviceAccount.name
    grafana = {
      description     = "Grafana CloudWatch, AMP data sources (read only)"
      namespace       = "monitoring"
      service_account = "kube-prometheus-stack-grafana"
    }
  }

  # 15-chatbot-vectors 인덱스 (s3vectors 리소스 ARN 형식 bucket/<버킷>/index/<인덱스>)
  vector_index_arn = "arn:${data.aws_partition.current.partition}:s3vectors:${var.region}:${data.aws_caller_identity.current.account_id}:bucket/${var.vector_bucket_name}/index/${var.vector_index_name}"

  # 72 클러스터 ARN. 이름으로 만들어 72 에 의존하지 않는다 (클러스터가 없어도 Role 을 만들 수 있음)
  eks_cluster_arn = "arn:${data.aws_partition.current.partition}:eks:${var.region}:${data.aws_caller_identity.current.account_id}:cluster/${var.eks_cluster_name}"
}

data "aws_iam_policy_document" "pod_assume" {
  for_each = local.pod_roles

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

  # Pod Identity Agent 가 AssumeRole 하며 세션 태그를 붙인다 (TagSession 필요).
  # Association 을 만들 때 세션 태그를 끄면(disable_session_tags) 아래 조건이 맞지 않아 거부된다
  dynamic "statement" {
    for_each = var.enable_pod_identity ? [1] : []

    content {
      sid     = "EksPodIdentity"
      actions = ["sts:AssumeRole", "sts:TagSession"]

      principals {
        type        = "Service"
        identifiers = ["pods.eks.amazonaws.com"]
      }

      condition {
        test     = "ArnEquals"
        variable = "aws:SourceArn"
        values   = [local.eks_cluster_arn]
      }

      condition {
        test     = "StringEquals"
        variable = "aws:RequestTag/kubernetes-namespace"
        values   = [each.value.namespace]
      }

      condition {
        test     = "StringEquals"
        variable = "aws:RequestTag/kubernetes-service-account"
        values   = [each.value.service_account]
      }
    }
  }
}

resource "aws_iam_role" "pod" {
  for_each = local.pod_roles

  name               = "${var.project}-${each.key}"
  description        = each.value.description
  assume_role_policy = data.aws_iam_policy_document.pod_assume[each.key].json
}

# ESO: 41-main-data 의 Secret(접속 정보 · 앱 서명 키)과 12-secrets 의 시드 관리자 · Grafana admin 계정 값 조회만.
# Secret ARN 끝의 무작위 6자는 ?????? 로 맞춘다
data "aws_iam_policy_document" "external_secrets" {
  statement {
    sid     = "GetAppSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      for name in concat(values(var.secret_names), [var.seed_admin_secret_name, var.grafana_admin_secret_name]) :
      "arn:${data.aws_partition.current.partition}:secretsmanager:${var.region}:${data.aws_caller_identity.current.account_id}:secret:${name}-??????"
    ]
  }
}

resource "aws_iam_role_policy" "external_secrets" {
  name   = "secrets-read"
  role   = aws_iam_role.pod["external-secrets"].id
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
  role   = aws_iam_role.pod["booking-service"].id
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
  role   = aws_iam_role.pod["hotel-service"].id
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
  role   = aws_iam_role.pod["seed"].id
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
  role   = aws_iam_role.pod["chat-bot-service"].id
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
  role   = aws_iam_role.pod["llm-service"].id
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
  role   = aws_iam_role.pod["llm-ingest"].id
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
  role   = aws_iam_role.pod["fluent-bit"].id
  policy = data.aws_iam_policy_document.fluent_bit.json
}

# deploy-notify: 10-global 배포 토픽 Publish 만 (암호화된 토픽이라 키 권한 포함)
data "aws_iam_policy_document" "deploy_notify" {
  statement {
    sid       = "PublishDeployResult"
    actions   = ["sns:Publish"]
    resources = ["arn:${data.aws_partition.current.partition}:sns:${var.region}:${data.aws_caller_identity.current.account_id}:${var.deploy_topic_name}"]
  }

  statement {
    sid       = "EncryptDeployResult"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = ["arn:${data.aws_partition.current.partition}:kms:${var.region}:${data.aws_caller_identity.current.account_id}:key/${var.notifications_kms_key_id}"]
  }
}

resource "aws_iam_role_policy" "deploy_notify" {
  name   = "deploy-notify"
  role   = aws_iam_role.pod["deploy-notify"].id
  policy = data.aws_iam_policy_document.deploy_notify.json
}

# alertmanager: 10-global 알림 토픽 Publish 만 (CloudWatch 알람과 같은 토픽 · 키)
data "aws_iam_policy_document" "alertmanager" {
  statement {
    sid       = "PublishAlerts"
    actions   = ["sns:Publish"]
    resources = ["arn:${data.aws_partition.current.partition}:sns:${var.region}:${data.aws_caller_identity.current.account_id}:${var.alerts_topic_name}"]
  }

  statement {
    sid       = "EncryptAlerts"
    actions   = ["kms:GenerateDataKey", "kms:Decrypt"]
    resources = ["arn:${data.aws_partition.current.partition}:kms:${var.region}:${data.aws_caller_identity.current.account_id}:key/${var.notifications_kms_key_id}"]
  }
}

resource "aws_iam_role_policy" "alertmanager" {
  name   = "alerts-publish"
  role   = aws_iam_role.pod["alertmanager"].id
  policy = data.aws_iam_policy_document.alertmanager.json
}

# grafana: CloudWatch 지표 조회 + 이 프로젝트 로그 그룹의 Logs Insights 조회만 (쓰기 · 알람 변경 없음).
#   GetMetricData · ListMetrics     리소스 지정을 지원하지 않아 * (읽기 전용 지표 API)
#   DescribeLogGroups               쿼리 편집기의 로그 그룹 선택 목록 (계정 · 리전의 log-group:* 만 지원)
#   StartQuery · GetLogGroupFields  RDS(41 · 42 /aws/rds/instance/<project>-*) · 이 환경 로그(/<project>/<env>/*: 클러스터 · 결제 서버)
#   GetQueryResults · StopQuery     쿼리 ID 로 동작해 리소스 지정을 지원하지 않음 (StartQuery 가 허용한 그룹만 결과가 있음)
data "aws_iam_policy_document" "grafana" {
  statement {
    sid       = "ReadMetrics"
    actions   = ["cloudwatch:GetMetricData", "cloudwatch:ListMetrics"]
    resources = ["*"]
  }

  statement {
    sid       = "ListLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:*"]
  }

  statement {
    sid     = "QueryProjectLogs"
    actions = ["logs:StartQuery", "logs:GetLogGroupFields"]
    resources = [
      "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/rds/instance/${var.project}-*",
      "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/${var.project}/${var.environment}/*",
    ]
  }

  statement {
    sid       = "QueryResults"
    actions   = ["logs:GetQueryResults", "logs:StopQuery"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "grafana" {
  name   = "cloudwatch-read"
  role   = aws_iam_role.pod["grafana"].id
  policy = data.aws_iam_policy_document.grafana.json
}

# grafana: 결제 지표 AMP 워크스페이스(10-global) 조회만 (LDP-181). RemoteWrite · 규칙 · Alertmanager 변경 없음
data "aws_iam_policy_document" "grafana_amp" {
  statement {
    sid = "QueryPaymentMetrics"
    actions = [
      "aps:QueryMetrics",
      "aps:GetSeries",
      "aps:GetLabels",
      "aps:GetMetricMetadata",
    ]
    resources = ["arn:${data.aws_partition.current.partition}:aps:${var.region}:${data.aws_caller_identity.current.account_id}:workspace/${var.payment_metrics_workspace_id}"]
  }
}

resource "aws_iam_role_policy" "grafana_amp" {
  name   = "amp-read"
  role   = aws_iam_role.pod["grafana"].id
  policy = data.aws_iam_policy_document.grafana_amp.json
}
