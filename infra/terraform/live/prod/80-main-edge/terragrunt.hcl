include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다
dependency "global" {
  config_path = "../10-global"
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
      subnet_ids_by_az = {}
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      main_alb    = "sg-00000000000000001"
      main_worker = "sg-00000000000000002"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "main_cluster" {
  config_path = "../70-main-cluster-kubeadm"

  mock_outputs = {
    worker_asg_name = "team04-hotel-main-worker"
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  # 값이 null 인 output 은 state 에 저장되지 않아 키 자체가 없다 (도메인 · 인증서 생성 전)
  log_bucket_name = dependency.global.outputs.log_bucket_name
  domain_name     = try(dependency.global.outputs.domain_name, null)
  zone_id         = try(dependency.global.outputs.zone_id, null)
  certificate_arn = try(dependency.global.outputs.certificate_arn, null)

  main_network    = dependency.network.outputs.main
  sg_ids          = dependency.security.outputs.sg_ids
  worker_asg_name = dependency.main_cluster.outputs.worker_asg_name
}
