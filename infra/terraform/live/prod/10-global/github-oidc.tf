# gitops 레포의 GitHub Actions 가 결제 서버 release(이미지 태그 + 비밀 아닌 설정)를 Parameter Store 에 쓰기 위한 OIDC 연동.
#
#   gitops 릴리스 PR merge (사람 승인) → GitHub Actions(main) → OIDC 토큰 → 이 Role → SSM PutParameter
#   결제 서버 pull agent 가 VPC 엔드포인트로 같은 파라미터를 읽어 갱신한다 (결제 VPC 는 GitHub 로 나가지 않음).
#
# 장기 액세스 키를 GitHub 에 두지 않는다. Runner 에는 이 쓰기 권한을 주지 않는다 (승인 없이 결제 서버를 바꾸는 경로가 됨).
# 같은 공급자로 모노레포 main 의 운영 릴리스 Role(아래 monorepo_release)도 받는다 — 산출물 업로드 · gitops PR 까지, 운영 전환 권한 없음.
#
# ⚠️ GitHub OIDC 공급자는 URL 이 고정이라 계정에 하나만 만들 수 있다 — 공유 계정의 다른 팀과 함께 쓰는 리소스다.
#    지우거나 audience 를 바꾸면 그 공급자를 쓰는 다른 팀 Role 도 끊긴다 (prevent_destroy).
#    다른 팀이 먼저 만들었으면 create_github_oidc_provider = false 로 두고 기존 공급자를 그대로 신뢰한다.
#    문제가 되면 계정 공용 리소스 없이 Lambda 폴러(공개 gitops 를 주기적으로 읽어 SSM 갱신)로 바꾼다.

locals {
  github_oidc_host = "token.actions.githubusercontent.com"
  # 공급자를 직접 만들든 기존 것을 쓰든 ARN 은 같다
  github_oidc_provider_arn = "arn:${data.aws_partition.current.partition}:iam::${local.account_id}:oidc-provider/${local.github_oidc_host}"

  # 11-registry 의 결제 서버 release 파라미터 {image_tag, env} (같은 이름 규칙, 스택 의존 없음)
  payment_release_parameter = "/${var.project}/${var.environment}/payment/release"
}

# GitHub 발급자는 AWS 가 신뢰하는 루트 CA 로 검증하므로 thumbprint 를 지정하지 않는다
resource "aws_iam_openid_connect_provider" "github" {
  count = var.create_github_oidc_provider ? 1 : 0

  url            = "https://${local.github_oidc_host}"
  client_id_list = ["sts.amazonaws.com"]

  lifecycle {
    prevent_destroy = true
  }
}

# 신뢰 정책은 aud · sub 를 정확히 비교한다 — gitops 레포의 main 브랜치 실행만 (PR · 다른 브랜치 · 다른 레포 거부).
# gitops 레포는 GitHub 의 immutable subject 형식(use_immutable_subject)이라 sub 에 조직 · 레포 숫자 ID 가 붙는다
#   repo:<조직>@<조직 ID>/<레포>@<레포 ID>:ref:refs/heads/main
# ID 는 바뀌지 않으므로 레포를 지우고 같은 이름으로 다시 만들거나 이름이 바뀌어도 다른 레포가 이 Role 을 받을 수 없다
data "aws_iam_policy_document" "gitops_ssm_sync_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = ["${var.gitops_oidc_subject_prefix}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "gitops_ssm_sync" {
  name                 = "${var.project}-gitops-ssm-sync"
  description          = "gitops main GitHub Actions: payment release to Parameter Store"
  assume_role_policy   = data.aws_iam_policy_document.gitops_ssm_sync_assume.json
  max_session_duration = 3600

  # IAM 이 신뢰 정책의 Federated principal 이 있는지 확인하므로 공급자를 먼저 만든다
  depends_on = [aws_iam_openid_connect_provider.github]
}

# 결제 서버 release 파라미터 하나만 쓴다
data "aws_iam_policy_document" "gitops_ssm_sync" {
  statement {
    sid       = "PutPaymentRelease"
    actions   = ["ssm:PutParameter", "ssm:GetParameter"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${local.account_id}:parameter${local.payment_release_parameter}"]
  }
}

resource "aws_iam_role_policy" "gitops_ssm_sync" {
  name   = "payment-release"
  role   = aws_iam_role.gitops_ssm_sync.id
  policy = data.aws_iam_policy_document.gitops_ssm_sync.json
}

# ── 모노레포 운영 릴리스 (.github/workflows/release.yml) ─────────────
#   릴리스 PR merge (사람 승인) → main push → GitHub Actions → OIDC 토큰 → 이 Role
#   → develop 에서 검증한 GHCR 이미지를 ECR 로 복사 · 프론트 빌드를 S3 releases/<SHA>/ 에 업로드 → gitops 릴리스 PR
# 40-cicd Runner Role 과 같은 산출물 권한이다. 운영 전환(KeyValueStore · 결제 release 파라미터)은 없다 — gitops 승인 후 위 Role 만.
# 신뢰 정책은 모노레포 main 실행만 받는다. workflow 에 environment 를 지정하면 sub 가 ...:environment:<이름> 으로 바뀌어 거부된다
data "aws_iam_policy_document" "monorepo_release_assume" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [local.github_oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "${local.github_oidc_host}:sub"
      values   = ["${var.monorepo_oidc_subject_prefix}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "monorepo_release" {
  name                 = var.monorepo_release_role_name
  description          = "monorepo main GitHub Actions: GHCR to ECR copy, frontend upload, gitops release PR"
  assume_role_policy   = data.aws_iam_policy_document.monorepo_release_assume.json
  max_session_duration = 3600

  depends_on = [aws_iam_openid_connect_provider.github]
}

# 이름이 고정인 리소스만 (11-registry 저장소 · 13-frontend 버킷 · 12-secrets Secret · Parameter). 스택 의존 없이 같은 이름 규칙으로 ARN 을 만든다.
# 저장소 · 버킷 · Secret 쪽 리소스 정책도 이 Role 이름을 허용 목록에 넣어야 한다 (11 push_only_ci · 13 writer_arns · 12 readers)
data "aws_iam_policy_document" "monorepo_release" {
  # 토큰 발급은 리소스 지정이 안 된다. 토큰만으로는 저장소 권한이 없으면 push · pull 할 수 없다
  statement {
    sid       = "GetEcrToken"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # 서비스 이미지 · n8n · dry-run 시험 저장소(<project>/release-dryrun). crane copy 는 push 전 레이어 · 기존 이미지를 조회한다
  statement {
    sid = "PushProjectImages"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = ["arn:${data.aws_partition.current.partition}:ecr:${var.region}:${local.account_id}:repository/${var.project}/*"]
  }

  # 프론트 빌드 업로드 — 릴리스(releases/<SHA>/)와 dry-run(dryrun/<SHA>/). cp --recursive 라 ListBucket 이 필요 없다
  statement {
    sid     = "UploadFrontendRelease"
    actions = ["s3:PutObject"]
    resources = [
      "arn:${data.aws_partition.current.partition}:s3:::${var.frontend_bucket_name}/releases/*",
      "arn:${data.aws_partition.current.partition}:s3:::${var.frontend_bucket_name}/dryrun/*",
    ]
  }

  # 프론트 빌드의 토스 결제위젯 클라이언트 키 (12-secrets frontend.tf, 공개용)
  statement {
    sid       = "GetTossClientKey"
    actions   = ["ssm:GetParameter"]
    resources = ["arn:${data.aws_partition.current.partition}:ssm:${var.region}:${local.account_id}:parameter/${var.project}/${var.environment}/frontend/toss-client-key"]
  }

  # gitops 릴리스 PR 용 GitHub App (12-secrets). ARN 끝의 무작위 6자는 ?????? 로 맞춘다
  statement {
    sid       = "GetGitHubApp"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = ["arn:${data.aws_partition.current.partition}:secretsmanager:${var.region}:${local.account_id}:secret:${var.project}/${var.environment}/github-app-??????"]
  }
}

resource "aws_iam_role_policy" "monorepo_release" {
  name   = "release-artifacts"
  role   = aws_iam_role.monorepo_release.id
  policy = data.aws_iam_policy_document.monorepo_release.json
}
