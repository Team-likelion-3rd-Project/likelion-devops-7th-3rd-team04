# CP 자동 부트스트랩 재료. CP user-data 가 S3 의 infra/ansible 묶음을 받아 aws-control-plane.yml 을 실행하고,
# join 정보는 Parameter Store 로 주고받는다.
#
#   join-token, certificate-key  여기서 생성 (SecureString). CP-a 가 init 에 쓰고 CP-b · c 가 join 에 쓴다
#   ca-cert-hash                 placeholder 로 생성, CP-a 가 init 후 기록 (Terraform 은 값 변경 무시)
#
# CA 는 Terraform 이 만들지 않는다. 만들면 CA 개인키가 state 에 남는다.

locals {
  ansible_dir    = "${path.module}/../../../../ansible"
  ansible_prefix = "ansible"

  # 커밋 대상만 올린다. .env · .secrets/ · inventory/hosts.ini(온프레미스 접속 정보) 는 아래 패턴에 걸리지 않는다
  ansible_files = setunion(
    fileset(local.ansible_dir, "*.{yml,cfg}"),
    fileset(local.ansible_dir, "inventory/aws.ini"),
    fileset(local.ansible_dir, "inventory/group_vars/*.yml"),
    fileset(local.ansible_dir, "filter_plugins/*.py"),
    fileset(local.ansible_dir, "roles/**"),
  )

  kubeadm_param_prefix = "/${var.project}/${var.environment}/kubeadm"
}

# 이름에 계정 ID 를 넣지 않으려고 bucket_prefix 로 만든다
resource "aws_s3_bucket" "ansible" {
  bucket_prefix = "${local.name}-ansible-"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "ansible" {
  bucket = aws_s3_bucket.ansible.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ansible 디렉터리 파일이 바뀌면 그 객체만 다시 올린다. 이미 떠 있는 CP 에는 반영되지 않는다 (매일 재생성 때 반영)
resource "aws_s3_object" "ansible" {
  for_each = local.ansible_files

  bucket      = aws_s3_bucket.ansible.id
  key         = "${local.ansible_prefix}/${each.value}"
  source      = "${local.ansible_dir}/${each.value}"
  source_hash = filemd5("${local.ansible_dir}/${each.value}")
}

# kubeadm bootstrap token 형식 [a-z0-9]{6}.[a-z0-9]{16}
resource "random_password" "join_token_id" {
  length  = 6
  special = false
  upper   = false
}

resource "random_password" "join_token_secret" {
  length  = 16
  special = false
  upper   = false
}

# kubeadm certificate-key 는 32바이트 hex (kubeadm-certs Secret 암호화 키)
resource "random_bytes" "certificate_key" {
  length = 32
}

# SecureString 은 AWS 관리형 키(aws/ssm) 로 암호화한다. 읽는 쪽은 ssm:GetParameter 권한만 있으면 된다
resource "aws_ssm_parameter" "join_token" {
  name  = "${local.kubeadm_param_prefix}/join-token"
  type  = "SecureString"
  value = "${random_password.join_token_id.result}.${random_password.join_token_secret.result}"
}

resource "aws_ssm_parameter" "certificate_key" {
  name  = "${local.kubeadm_param_prefix}/certificate-key"
  type  = "SecureString"
  value = random_bytes.certificate_key.hex
}

resource "aws_ssm_parameter" "ca_cert_hash" {
  name = "${local.kubeadm_param_prefix}/ca-cert-hash"
  type = "String"

  # Parameter Store 는 빈 값을 허용하지 않는다. infra/ansible group_vars 의 kubeadm_ca_cert_hash_pending 과 같아야 한다
  value = "pending"

  lifecycle {
    ignore_changes = [value]
  }
}
