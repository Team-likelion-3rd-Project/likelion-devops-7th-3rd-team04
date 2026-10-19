terraform {
  # S3 네이티브 락킹(use_lockfile) · ephemeral 리소스 · write-only 속성은 1.11 부터 GA
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
