provider "google" {
  project                     = var.project_id
  region                      = var.region
  impersonate_service_account = var.terraform_service_account

  default_labels = {
    managed-by  = "terraform"
    environment = "dev"
  }
}
