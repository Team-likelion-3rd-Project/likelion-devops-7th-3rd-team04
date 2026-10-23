include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. run --all destroy 대상에서 빼고, 이 디렉터리에서 직접 destroy 해도 막는다
# (Workload Identity Pool · Provider 는 삭제 후 30일 동안 같은 ID 를 다시 쓸 수 없어 매일 재생성이 불가능하다)
prevent_destroy = true

exclude {
  if      = true
  actions = ["destroy"]
}

# GCP 리소스만 만든다. root.hcl 은 이 유닛에 AWS provider 를 생성하지 않고(non_aws_stacks), 여기서 google provider 를 생성한다.
# state 는 다른 유닛과 같은 S3 버킷(prod/gcp-llm)이라 AWS 자격 증명도 그대로 필요하다.
# 사람 계정(ADC)으로 terraform 서비스 계정을 impersonate 한다 — gcloud auth application-default login
#
# 같은 1x 단계인 10-global 은 dependency 로 참조하지 않는다 (번호 규칙).
# OIDC 발급자 주소는 10-global 과 같은 규칙으로 버킷 이름에서 만든다 (variables.tf)
generate "provider_google" {
  path      = "providers-google.generated.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "google" {
      project                     = var.gcp_project_id
      region                      = var.gcp_region
      impersonate_service_account = var.terraform_service_account

      default_labels = {
        managed-by  = "terraform"
        environment = var.environment
        stack       = "gcp-llm"
      }
    }
  EOF
}
