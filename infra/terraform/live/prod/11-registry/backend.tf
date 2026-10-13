terraform {
  backend "s3" {
    key = "prod/registry/terraform.tfstate"
  }
}
