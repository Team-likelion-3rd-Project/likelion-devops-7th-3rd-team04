# GCP 스택들이 공유하는 Terraform state 버킷 (infra/terraform/live/bootstrap 의 S3 버킷과 같은 역할).
#
# 이 스택은 의도적으로 backend 블록 없이 로컬 state 를 사용한다. (자기 자신이 만들 버킷에 state 를 둘 수 없음)
# 로컬 state 를 잃어버리면 아래처럼 import 로 복구한다.
#   terraform import google_storage_bucket.tfstate <버킷 이름>

resource "google_storage_bucket" "tfstate" {
  name     = var.state_bucket_name
  location = var.region

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # state 손상/실수 시 이전 버전으로 복구하기 위해 버저닝 필수
  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      days_since_noncurrent_time = var.noncurrent_version_retention_days
    }
    action {
      type = "Delete"
    }
  }

  lifecycle {
    prevent_destroy = true
  }
}

# 다른 스택의 backend "gcs" 가 impersonate_service_account 로 state 에 접근할 때 이 프로젝트의
# IAM Credentials API 를 거칩니다(꺼져 있으면 init 이 403 SERVICE_DISABLED 로 실패).
resource "google_project_service" "iamcredentials" {
  service            = "iamcredentials.googleapis.com"
  disable_on_destroy = false
}
