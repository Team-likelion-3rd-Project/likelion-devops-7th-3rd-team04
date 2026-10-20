include "root" {
  path = find_in_parent_folders("root.hcl")
}

dependency "network" {
  config_path = "../20-network"

  # 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
  mock_outputs = {
    main = {
      vpc_id = "vpc-00000000000000000"
    }
    deployment = {
      vpc_id = "vpc-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  main_vpc_id       = dependency.network.outputs.main.vpc_id
  deployment_vpc_id = dependency.network.outputs.deployment.vpc_id
}
