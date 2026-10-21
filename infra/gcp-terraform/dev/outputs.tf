output "llm_service_account_email" {
  description = "키 발급(gcloud iam service-accounts keys create --iam-account)에 쓰는 서비스 계정 이메일"
  value       = google_service_account.llm_service.email
}
