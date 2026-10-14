terraform {
  backend "s3" {
    key = "prod/main-cluster-kubeadm/terraform.tfstate"
  }
}
