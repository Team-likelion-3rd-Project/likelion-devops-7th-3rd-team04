terraform {
  backend "s3" {
    key = "prod/main-edge/terraform.tfstate"
  }
}
