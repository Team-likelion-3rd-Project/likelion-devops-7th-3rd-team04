include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 부팅 때 엔드포인트(ECR · SSM)를 쓰므로 44 가 먼저 떠 있어야 한다. 44 는 output 이 없어 순서만 건다
dependencies {
  paths = ["../44-payment-endpoints"]
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    payment = {
      subnet_ids_by_az = {
        app = { a = "subnet-00000000000000003", b = "subnet-00000000000000004" }
      }
      app_static_cidr = "10.20.8.16/28"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      payment_mock = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  app_subnet_id = dependency.network.outputs.payment.subnet_ids_by_az.app.a
  static_cidr   = dependency.network.outputs.payment.app_static_cidr
  sg_ids        = dependency.security.outputs.sg_ids
}
