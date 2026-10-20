include "root" {
  path = find_in_parent_folders("root.hcl")
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    deployment = {
      subnet_ids = {
        runner = ["subnet-00000000000000001"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      deployment_runner = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  deployment_network = dependency.network.outputs.deployment
  sg_ids             = dependency.security.outputs.sg_ids
}
