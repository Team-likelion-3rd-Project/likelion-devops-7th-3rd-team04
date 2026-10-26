# 모두 공개 값이다 (비밀 없음). 파드는 output credential_config 와 projected 토큰만으로 인증한다.

output "gcp_project_number" {
  description = "GCP 프로젝트 번호 (audience · principal 에 들어감)"
  value       = data.google_project.this.number
}

output "workload_identity_pool_name" {
  description = "Pool 전체 이름 (projects/<번호>/locations/global/workloadIdentityPools/<ID>)"
  value       = google_iam_workload_identity_pool.main.name
}

output "workload_identity_provider_name" {
  description = "Provider 전체 이름"
  value       = google_iam_workload_identity_pool_provider.main_cluster.name
}

output "workload_identity_audience" {
  description = "projected 토큰의 audience 이자 credential 설정의 audience"
  value       = "//iam.googleapis.com/${google_iam_workload_identity_pool_provider.main_cluster.name}"
}

output "llm_service_account_email" {
  description = "파드가 impersonate 하는 운영 서비스 계정"
  value       = google_service_account.llm_service.email
}

output "credential_config" {
  description = "GOOGLE_APPLICATION_CREDENTIALS 로 가리킬 external_account 설정 JSON (google-auth 가 토큰 파일을 읽어 STS 교환 → impersonate)"
  value = jsonencode({
    type                              = "external_account"
    audience                          = "//iam.googleapis.com/${google_iam_workload_identity_pool_provider.main_cluster.name}"
    subject_token_type                = "urn:ietf:params:oauth:token-type:jwt"
    token_url                         = "https://sts.googleapis.com/v1/token"
    service_account_impersonation_url = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${google_service_account.llm_service.email}:generateAccessToken"
    credential_source = {
      file = var.credential_token_path
      format = {
        type = "text"
      }
    }
  })
}
