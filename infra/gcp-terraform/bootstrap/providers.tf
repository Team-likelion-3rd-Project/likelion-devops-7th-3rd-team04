# 사람 계정(ADC)으로 terraform 서비스 계정을 impersonate 해서 실행합니다 — 키 파일 불필요.
#   gcloud auth application-default login   (본인 계정에 terraform SA 의 Token Creator 권한 필요)
provider "google" {
  project                     = var.project_id
  region                      = var.region
  impersonate_service_account = var.terraform_service_account

  default_labels = {
    managed-by = "terraform"
    stack      = "bootstrap"
  }
}
