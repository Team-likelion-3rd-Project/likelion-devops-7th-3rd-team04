include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 결제 서버는 부팅 때 엔드포인트(ECR · SSM · Secrets Manager 등)를 쓰므로 44 가 먼저 떠 있어야 한다. 44 는 output 이 없어 순서만 건다
dependencies {
  paths = ["../44-payment-endpoints"]
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다 (배포 결과 토픽 · 암호화 키)
dependency "global" {
  config_path = "../10-global"
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
dependency "network" {
  config_path = "../20-network"

  mock_outputs = {
    payment = {
      vpc_id = "vpc-00000000000000002"
      subnet_ids = {
        lb  = ["subnet-00000000000000001", "subnet-00000000000000002"]
        app = ["subnet-00000000000000003", "subnet-00000000000000004"]
      }
      subnet_ids_by_az = {
        lb  = { a = "subnet-00000000000000001", b = "subnet-00000000000000002" }
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
      payment_app = "sg-00000000000000001"
      payment_nlb = "sg-00000000000000002"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# 결제 서버가 부팅 때 결제 DB 마이그레이션을 실행하므로(LDP-116) RDS 가 먼저 떠 있어야 한다
dependency "payment_data" {
  config_path = "../42-payment-data"

  mock_outputs = {
    secret_name = "team04-hotel/prod/payment-db"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "messaging" {
  config_path = "../43-messaging"

  mock_outputs = {
    queue_names = {
      payment_result     = "payment-result.fifo"
      payment_result_dlq = "payment-result-dlq.fifo"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  deploy_topic_name        = dependency.global.outputs.deploy_topic_name
  notifications_kms_key_id = dependency.global.outputs.notifications_kms_key_id

  payment_network        = dependency.network.outputs.payment
  sg_ids                 = dependency.security.outputs.sg_ids
  payment_db_secret_name = dependency.payment_data.outputs.secret_name
  queue_names            = dependency.messaging.outputs.queue_names
}
