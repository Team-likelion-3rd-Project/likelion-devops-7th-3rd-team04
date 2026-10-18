include "root" {
  path = find_in_parent_folders("root.hcl")
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
  main_network = dependency.network.outputs.main
  sg_ids       = dependency.security.outputs.sg_ids
}
