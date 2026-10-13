terraform {
  backend "s3" {
    key = "prod/network/terraform.tfstate"
  }
}
