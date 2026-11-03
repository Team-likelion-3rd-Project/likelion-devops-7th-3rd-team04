include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다
dependency "global" {
  config_path = "../10-global"
}

# 파드 Role(IRSA) 이 있어야 부트스트랩 직후 ESO · backend 가 자격 증명을 얻는다. output 은 읽지 않고 순서만 맞춘다
# (51 이 41 · 43 뒤라 노드도 DB · 큐가 생긴 뒤에 뜬다)
dependencies {
  paths = ["../51-pod-roles"]
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    main = {
      vpc_id   = "vpc-00000000000000000"
      vpc_cidr = "10.10.0.0/16"
      subnet_ids = {
        public = ["subnet-00000000000000001", "subnet-00000000000000002"]
        worker = ["subnet-00000000000000003", "subnet-00000000000000004"]
      }
      subnet_ids_by_az = {
        cp = { a = "subnet-00000000000000005", b = "subnet-00000000000000006", c = "subnet-00000000000000007" }
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      main_alb          = "sg-00000000000000001"
      main_worker       = "sg-00000000000000002"
      main_cp           = "sg-00000000000000003"
      main_internal_nlb = "sg-00000000000000004"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  oidc_issuer_url  = dependency.global.outputs.oidc_issuer_url
  oidc_bucket_name = dependency.global.outputs.oidc_bucket_name

  main_network = dependency.network.outputs.main
  sg_ids       = dependency.security.outputs.sg_ids
}
