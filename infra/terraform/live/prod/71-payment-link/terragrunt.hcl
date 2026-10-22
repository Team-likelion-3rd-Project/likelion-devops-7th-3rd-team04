include "root" {
  path = find_in_parent_folders("root.hcl")
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    main = {
      vpc_id = "vpc-00000000000000000"
      subnet_ids = {
        worker = ["subnet-00000000000000003", "subnet-00000000000000004"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      main_privatelink = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "payment_app" {
  config_path = "../60-payment-app"

  mock_outputs = {
    endpoint_service_name = "com.amazonaws.vpce.us-east-1.vpce-svc-00000000000000000"
    grpc_port             = 3004
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  main_vpc_id           = dependency.network.outputs.main.vpc_id
  worker_subnet_ids     = dependency.network.outputs.main.subnet_ids.worker
  sg_ids                = dependency.security.outputs.sg_ids
  endpoint_service_name = dependency.payment_app.outputs.endpoint_service_name
  grpc_port             = dependency.payment_app.outputs.grpc_port
}
