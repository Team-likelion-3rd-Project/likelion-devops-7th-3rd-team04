provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Environment = var.environment
      Stack       = "main-cluster-kubeadm"
      ManagedBy   = "terraform"
    }
  }
}
