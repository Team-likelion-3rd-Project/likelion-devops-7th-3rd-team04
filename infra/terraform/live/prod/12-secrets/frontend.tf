# 토스 결제위젯 클라이언트 키 (test_gck_* · live_gck_*). 프론트 빌드(release:frontend-build)가 VITE_TOSS_CLIENT_KEY 로 넣는다.
#
# 브라우저에 그대로 노출되는 공개 키라 Secrets Manager 대신 Parameter Store String 이다.
# 공개 레포 · git 이력에 남기지 않고, 시크릿 키(toss-payments)와 같은 스택에서 한 쌍으로 관리하려고 여기에 둔다.
# 시크릿 키 Secret 에 함께 넣지 않는다 — 그러면 Runner 가 그 Secret 을 읽어야 해서 시크릿 키가 Runner 에 노출된다.
#
# 다른 Secret 과 같이 ephemeral 변수 → write-only(value_wo) 로 넣는다. 값을 바꿀 때는 toss_credentials_version 을 올린다.
# 새 값은 다음 릴리스 빌드부터 반영된다 (변경 이력: aws ssm get-parameter-history).
# 읽는 쪽은 40-cicd Runner Role · 10-global 릴리스 Role (각 Role 의 IAM 정책이 같은 이름 규칙으로 ARN 을 만든다)

resource "aws_ssm_parameter" "toss_client_key" {
  name        = "/${var.project}/${var.environment}/frontend/toss-client-key"
  description = "Toss Payments widget client key (VITE_TOSS_CLIENT_KEY, public)"
  type        = "String"

  value_wo         = var.toss_client_key
  value_wo_version = var.toss_credentials_version

  lifecycle {
    prevent_destroy = true
  }
}
