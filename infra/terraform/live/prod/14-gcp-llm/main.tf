# 운영 llm-service 가 서비스 계정 키 없이 Vertex AI 를 호출하기 위한 Workload Identity Federation.
#
#   파드 projected ServiceAccount 토큰 (iss = 메인 클러스터 OIDC 발급자, aud = Provider)
#     → STS 토큰 교환 (Provider 가 발급자의 keys.json 으로 서명 검증, attribute_condition 으로 네임스페이스 제한)
#     → llm-service-prod 서비스 계정 impersonate (workloadIdentityUser 를 받은 ServiceAccount 만)
#     → Vertex AI
#
# 발급자는 IRSA 와 같은 공개 버킷(10-global irsa.tf)이다. keys.json 은 매일 재생성 때 클러스터가 새 서명키로 다시 올린다.
# 온프레미스 dev 는 infra/gcp-terraform/dev (SA 키 방식) 그대로다.

locals {
  oidc_issuer_url = "https://${var.oidc_bucket_name}.s3.${var.region}.amazonaws.com"
}

data "google_project" "this" {}

resource "google_project_service" "this" {
  for_each = toset([
    "iam.googleapis.com",            # Workload Identity Pool · 서비스 계정
    "sts.googleapis.com",            # 클러스터 토큰 → 연합 토큰 교환
    "iamcredentials.googleapis.com", # 연합 토큰 → 서비스 계정 토큰 (impersonate)
    "aiplatform.googleapis.com",     # Vertex AI (이미 켜져 있지만 의존성을 명시)
  ])

  service = each.value
  # 같은 프로젝트를 온프레미스 dev 도 쓰므로 destroy 시에도 끄지 않는다
  disable_on_destroy = false
}

resource "google_iam_workload_identity_pool" "main" {
  workload_identity_pool_id = var.workload_identity_pool_id
  display_name              = "${var.project} ${var.environment}"
  description               = "AWS 운영 메인 클러스터(kubeadm) ServiceAccount 토큰 연합"

  depends_on = [google_project_service.this]

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_iam_workload_identity_pool_provider" "main_cluster" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.main.workload_identity_pool_id
  workload_identity_pool_provider_id = var.workload_identity_provider_id
  display_name                       = "main cluster OIDC"
  description                        = "메인 클러스터 ServiceAccount 토큰 발급자 (${local.oidc_issuer_url})"

  # sub = system:serviceaccount:<네임스페이스>:<ServiceAccount>
  attribute_mapping = {
    "google.subject" = "assertion.sub"
  }

  # 허용 네임스페이스 밖의 토큰은 교환 자체를 거부한다 (서비스 계정 바인딩보다 앞 단계)
  attribute_condition = "assertion.sub.startsWith(\"system:serviceaccount:${var.allowed_namespace}:\")"

  # allowed_audiences 를 비우면 토큰 aud 가 이 Provider 의 전체 이름(output workload_identity_audience)이어야 한다.
  # jwks_json 을 넣지 않아 GCP 가 발급자 문서의 jwks_uri(keys.json)를 읽는다 — 매일 바뀌는 서명키를 따라간다
  oidc {
    issuer_uri = local.oidc_issuer_url
  }

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_service_account" "llm_service" {
  account_id   = var.llm_service_account_id
  display_name = "llm-service (AWS prod)"
  description  = "운영 메인 클러스터 llm-service · llm-ingest 의 Vertex AI 호출용. 키 없이 Workload Identity Federation 으로만 사용"

  depends_on = [google_project_service.this]
}

# terraform SA 의 projectIamAdmin 은 roles/aiplatform.user 만 부여할 수 있게 조건이 걸려 있으므로,
# 다른 바인딩을 건드리는 authoritative 리소스(_binding / _policy)는 쓰지 않고 _member 만 쓴다.
resource "google_project_iam_member" "llm_service_vertex" {
  project = var.gcp_project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.llm_service.email}"
}

# 지정한 쿠버네티스 ServiceAccount 만 이 서비스 계정을 impersonate 한다.
# terraform SA 에 이 서비스 계정 한정 IAM 관리 권한이 있어야 한다 (README "GCP 사전 작업")
resource "google_service_account_iam_member" "workload_identity_user" {
  for_each = var.kubernetes_service_accounts

  service_account_id = google_service_account.llm_service.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/${google_iam_workload_identity_pool.main.name}/subject/system:serviceaccount:${var.allowed_namespace}:${each.value}"
}
