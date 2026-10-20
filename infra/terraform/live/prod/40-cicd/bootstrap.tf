# Runner 자동 부트스트랩 재료. user-data 가 S3 의 infra/ansible 묶음을 받아 aws-runner.yml 을 실행한다 (70 bootstrap.tf 와 같은 방식).

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

# ansible 디렉터리 파일이 바뀌면 그 객체만 다시 올린다. 이미 떠 있는 Runner 에는 반영되지 않는다 (매일 재생성 때 반영)
resource "aws_s3_object" "ansible" {
  for_each = local.ansible_files

  bucket      = aws_s3_bucket.ansible.id
  key         = "${local.ansible_prefix}/${each.value}"
  source      = "${local.ansible_dir}/${each.value}"
  source_hash = filemd5("${local.ansible_dir}/${each.value}")
}
