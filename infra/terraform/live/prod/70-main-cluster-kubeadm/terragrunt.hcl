include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 10-global · 13-frontend · 15-chatbot-vectors 는 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다
dependency "global" {
  config_path = "../10-global"
}

dependency "frontend" {
  config_path = "../13-frontend"
}

dependency "chatbot_vectors" {
  config_path = "../15-chatbot-vectors"
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

dependency "observability_base" {
  config_path = "../21-observability-base"

  mock_outputs = {
    cluster_log_group_names = {
      backend = "/team04-hotel/prod/cluster/backend"
      other   = "/team04-hotel/prod/cluster/other"
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

dependency "main_data" {
  config_path = "../41-main-data"

  mock_outputs = {
    secret_names = {
      main_db     = "team04-hotel/prod/main-db"
      main_valkey = "team04-hotel/prod/main-valkey"
      backend_app = "team04-hotel/prod/backend-app"
    }
    dynamodb_table_names = {
      chat_sessions = "team04-hotel-ChatSessions"
      chat_messages = "team04-hotel-ChatMessages"
    }
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
  oidc_issuer_url  = dependency.global.outputs.oidc_issuer_url
  oidc_bucket_name = dependency.global.outputs.oidc_bucket_name
  log_bucket_name  = dependency.global.outputs.log_bucket_name

  deploy_topic_name        = dependency.global.outputs.deploy_topic_name
  alerts_topic_name        = dependency.global.outputs.alerts_topic_name
  notifications_kms_key_id = dependency.global.outputs.notifications_kms_key_id

  cluster_log_group_names = dependency.observability_base.outputs.cluster_log_group_names

  image_bucket_name = dependency.frontend.outputs.image_bucket_name

  vector_bucket_name = dependency.chatbot_vectors.outputs.vector_bucket_name
  vector_index_name  = dependency.chatbot_vectors.outputs.vector_index_name

  main_network         = dependency.network.outputs.main
  sg_ids               = dependency.security.outputs.sg_ids
  secret_names         = dependency.main_data.outputs.secret_names
  dynamodb_table_names = dependency.main_data.outputs.dynamodb_table_names
  queue_names          = dependency.messaging.outputs.queue_names
}
