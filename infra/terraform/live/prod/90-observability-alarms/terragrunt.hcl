include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 알람 대상 스택보다 뒤(맨 마지막)에 만든다. 대상 리소스는 이름 · arn_suffix 로만 받는다

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다 (알람 토픽)
dependency "global" {
  config_path = "../10-global"
}

# mock_outputs: 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
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

dependency "main_data" {
  config_path = "../41-main-data"

  mock_outputs = {
    db_instance_identifier = "team04-hotel-main"
    valkey_member_clusters = ["team04-hotel-main-001"]
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "payment_data" {
  config_path = "../42-payment-data"

  mock_outputs = {
    db_instance_identifier = "team04-hotel-payment"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "payment_app" {
  config_path = "../60-payment-app"

  mock_outputs = {
    nlb_arn_suffix          = "net/team04-hotel-payment-app/0000000000000000"
    target_group_arn_suffix = "targetgroup/team04-hotel-payment-app/0000000000000000"
    deploy_log_group_name   = "/team04-hotel/prod/payment/deploy"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "main_edge" {
  config_path = "../80-main-edge"

  mock_outputs = {
    alb_arn_suffix          = "app/team04-hotel-main-alb/0000000000000000"
    target_group_arn_suffix = "targetgroup/team04-hotel-main-worker/0000000000000000"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  alerts_topic_name = dependency.global.outputs.alerts_topic_name

  payment_metrics_workspace_id = dependency.global.outputs.payment_metrics_workspace_id

  queue_names = dependency.messaging.outputs.queue_names

  payment_nlb_arn_suffix          = dependency.payment_app.outputs.nlb_arn_suffix
  payment_target_group_arn_suffix = dependency.payment_app.outputs.target_group_arn_suffix
  payment_deploy_log_group_name   = dependency.payment_app.outputs.deploy_log_group_name

  db_instance_identifiers = {
    main    = dependency.main_data.outputs.db_instance_identifier
    payment = dependency.payment_data.outputs.db_instance_identifier
  }
  valkey_member_clusters = dependency.main_data.outputs.valkey_member_clusters

  alb_arn_suffix              = dependency.main_edge.outputs.alb_arn_suffix
  alb_target_group_arn_suffix = dependency.main_edge.outputs.target_group_arn_suffix
}
