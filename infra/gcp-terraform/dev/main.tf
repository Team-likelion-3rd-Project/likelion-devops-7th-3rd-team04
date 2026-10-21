# 온프레미스 dev 클러스터의 llm-service 가 Vertex AI(Gemini · 임베딩)를 호출하기 위한 GCP 구성.
# 서비스 계정 키는 비밀키가 state 에 남지 않도록 Terraform 밖에서 gcloud 로 발급합니다 (README 참고).

resource "google_project_service" "this" {
  for_each = toset([
    "iam.googleapis.com",        # 서비스 계정 생성
    "aiplatform.googleapis.com", # Vertex AI (이미 켜져 있지만 의존성을 명시)
  ])

  service = each.value
  # API 를 끄면 같은 프로젝트를 쓰는 다른 리소스가 깨질 수 있어 destroy 시에도 끄지 않음
  disable_on_destroy = false
}

resource "google_service_account" "llm_service" {
  account_id   = var.llm_service_account_id
  display_name = "llm-service (on-prem dev)"
  description  = "온프레미스 dev 클러스터 llm-service 의 Vertex AI 호출용. 키는 gcloud 로 발급해 Ansible 이 backend-secrets 에 넣음"

  depends_on = [google_project_service.this]
}

# terraform SA 의 projectIamAdmin 은 roles/aiplatform.user 만 부여할 수 있게 조건이 걸려 있으므로,
# 다른 바인딩을 건드리는 authoritative 리소스(_binding / _policy)는 쓰지 않고 _member 만 씁니다.
resource "google_project_iam_member" "llm_service_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.llm_service.email}"
}
