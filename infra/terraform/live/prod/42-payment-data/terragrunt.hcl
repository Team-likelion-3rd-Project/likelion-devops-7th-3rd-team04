include "root" {
  path = find_in_parent_folders("root.hcl")
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    payment = {
      subnet_ids = {
        db = ["subnet-00000000000000001", "subnet-00000000000000002"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      payment_db = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  db_subnet_ids = dependency.network.outputs.payment.subnet_ids.db
  sg_ids        = dependency.security.outputs.sg_ids
}
