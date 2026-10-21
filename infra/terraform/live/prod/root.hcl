# prod 유닛 공통 설정. 각 유닛의 terragrunt.hcl 이 include 한다.
#   - backend · provider 는 이 파일이 생성한다 (유닛에 backend.tf · providers.tf 를 두지 않는다)
#   - state key · Stack 태그는 디렉터리 이름에서 번호를 뗀 값이다 (20-network → network)

locals {
  stack = regex("^\\d+-(.+)$", basename(get_terragrunt_dir()))[0]
}

# Terragrunt 는 유닛을 .terragrunt-cache 로 복사해 실행한다.
# 유닛 밖 상대 경로(../../../modules/vpc, 70 의 ../../../../ansible)가 깨지지 않도록 infra/ 전체를 복사하고 유닛 경로에서 실행한다.
terraform {
  source = "${get_repo_root()}/infra//terraform/live/prod/${path_relative_to_include()}"

  # 로컬 state(bootstrap) 를 캐시로 복사하지 않는다
  exclude_from_copy = ["**/*.tfstate", "**/*.tfstate.backup"]
}

remote_state {
  backend = "s3"

  generate = {
    path      = "backend.generated.tf"
    if_exists = "overwrite_terragrunt"
  }

  config = {
    bucket       = "team04-hotel-tfstate"
    key          = "prod/${local.stack}/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true

    # 버킷은 bootstrap 이 관리한다. Terragrunt 가 버킷 설정(버전 관리 · 암호화 · 정책)을 바꾸지 않게 한다
    disable_bucket_update = true
  }
}

generate "provider" {
  path      = "providers.generated.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF
    provider "aws" {
      region = var.region

      default_tags {
        tags = {
          Project     = var.project
          Environment = var.environment
          Stack       = "${local.stack}"
          ManagedBy   = "terraform"
        }
      }
    }
  EOF
}
