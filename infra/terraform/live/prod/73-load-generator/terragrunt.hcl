include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다
dependency "global" {
  config_path = "../10-global"
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    main = {
      subnet_ids = {
        public = ["subnet-00000000000000001", "subnet-00000000000000002"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      main_load_generator = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  log_bucket_name  = dependency.global.outputs.log_bucket_name
  public_subnet_id = dependency.network.outputs.main.subnet_ids.public[0]
  sg_ids           = dependency.security.outputs.sg_ids
}
