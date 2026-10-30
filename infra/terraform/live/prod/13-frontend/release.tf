# 버전 전환 권한: gitops main GitHub Actions(sync-frontend-version) 가 assume 하는 10-global Role 에 이 KeyValueStore 갱신만 붙인다.
# KeyValueStore ARN 끝은 생성 시 무작위 ID 라 10-global 에서 미리 쓸 수 없어 이 스택에서 연결한다 (연결 리소스는 사용하는 쪽 스택).
# 이 Role 에는 S3 쓰기가 없으므로 Actions 는 업로드를 못 하고, 업로드하는 릴리스 Role 에는 이 권한이 없으므로 승인 없이 버전을 바꾸지 못한다.
#
# put-key 는 현재 ETag(If-Match) 가 필요해 Describe 로 먼저 읽는다. GetKey 는 변경 전 값 확인 · 같은 값이면 건너뛰기용
data "aws_iam_policy_document" "release_sync" {
  statement {
    sid = "SwitchFrontendVersion"
    actions = [
      "cloudfront-keyvaluestore:DescribeKeyValueStore",
      "cloudfront-keyvaluestore:GetKey",
      "cloudfront-keyvaluestore:PutKey",
    ]
    resources = [aws_cloudfront_key_value_store.main.arn]
  }

  # 전환 전 그 버전의 빌드가 올라가 있는지 확인 (head-object releases/<SHA>/index.html). 읽기만, 쓰기는 버킷 정책이 거부
  statement {
    sid       = "CheckReleaseUploaded"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.this["site"].arn}/${local.release_prefix}/*/index.html"]
  }
}

resource "aws_iam_role_policy" "release_sync" {
  name   = "frontend-version"
  role   = var.release_sync_role_name
  policy = data.aws_iam_policy_document.release_sync.json
}
