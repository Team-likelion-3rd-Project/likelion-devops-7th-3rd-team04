include "root" {
  path = find_in_parent_folders("root.hcl")
}

# helm provider 는 이 유닛만 쓴다. 클러스터가 같은 스택에서 생기므로 주소 · CA 는 리소스에서 읽고, 토큰은 실행할 때 받는다
generate "provider_helm" {
  path      = "providers-helm.generated.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<-EOF2
    provider "helm" {
      kubernetes = {
        host                   = aws_eks_cluster.this.endpoint
        cluster_ca_certificate = base64decode(aws_eks_cluster.this.certificate_authority[0].data)
        exec = {
          api_version = "client.authentication.k8s.io/v1beta1"
          command     = "aws"
          args        = ["eks", "get-token", "--cluster-name", aws_eks_cluster.this.name, "--region", var.region]
        }
      }
    }
  EOF2
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
      subnet_ids_by_az = {
        worker = { a = "subnet-00000000000000003", b = "subnet-00000000000000004" }
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

dependency "security" {
  config_path = "../30-security"

  mock_outputs = {
    sg_ids = {
      main_worker = "sg-00000000000000002"
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

# 신뢰 정책에 Pod Identity 가 들어간 Role 이 있어야 파드가 자격 증명을 얻는다 (51 이 41 · 43 뒤라 노드도 DB · 큐가 생긴 뒤에 뜬다)
dependency "pod_roles" {
  config_path = "../51-pod-roles"

  mock_outputs = {
    pod_role_bindings = {
      external-secrets = {
        role_name       = "team04-hotel-external-secrets"
        namespace       = "external-secrets"
        service_account = "external-secrets"
      }
    }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  vpc_id            = dependency.network.outputs.main.vpc_id
  worker_subnet_ids = dependency.network.outputs.main.subnet_ids.worker
  # 노드 그룹을 가용 영역마다 하나씩 (LDP-248)
  worker_subnet_ids_by_az = dependency.network.outputs.main.subnet_ids_by_az.worker
  worker_sg_id      = dependency.security.outputs.sg_ids.main_worker
  pod_role_bindings = dependency.pod_roles.outputs.pod_role_bindings
}
