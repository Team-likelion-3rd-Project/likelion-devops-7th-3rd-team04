include "root" {
  path = find_in_parent_folders("root.hcl")
}

# Lambda 가 SQS 인터페이스 엔드포인트로 큐에 보내므로 44 가 먼저 떠 있어야 한다. 44 는 output 이 없어 순서만 건다
dependencies {
  paths = ["../44-payment-endpoints"]
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다 (도메인 · Zone · 인증서)
dependency "global" {
  config_path = "../10-global"
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    payment = {
      subnet_ids = {
        app = ["subnet-00000000000000001", "subnet-00000000000000002"]
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      payment_lambda = "sg-00000000000000001"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  domain_name     = dependency.global.outputs.domain_name
  zone_id         = dependency.global.outputs.zone_id
  certificate_arn = dependency.global.outputs.certificate_arn

  app_subnet_ids = dependency.network.outputs.payment.subnet_ids.app
  sg_ids         = dependency.security.outputs.sg_ids
}
