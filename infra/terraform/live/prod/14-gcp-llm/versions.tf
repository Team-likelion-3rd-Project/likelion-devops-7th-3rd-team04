terraform {
  # S3 네이티브 락킹(use_lockfile)은 1.11 부터 GA
  required_version = ">= 1.11"

  required_providers {
    # infra/gcp-terraform(온프레미스 dev)과 같은 버전대
    google = {
      source  = "hashicorp/google"
      version = "~> 8.5"
    }
  }
}
