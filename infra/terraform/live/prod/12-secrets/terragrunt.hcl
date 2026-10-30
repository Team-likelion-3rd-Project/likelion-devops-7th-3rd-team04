include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. 직접 destroy 해도 막는다
prevent_destroy = true

# 값(ephemeral 변수)을 넣을 때만 이 디렉터리에서 직접 apply 한다 (README 5절).
# run --all 은 apply · destroy · plan 모두에서 뺀다
exclude {
  if      = true
  actions = ["all"]
}

# 운영 비밀값은 이 디렉터리의 .env(gitignore)에만 둔다. 형식은 .env.example.
# 다른 디렉터리의 .env(backend · ansible 개발 설정)를 읽지 않아 운영 값이 개발 설정 변경을 따라가지 않는다.
# Terragrunt 는 inputs 를 TF_VAR_* 환경변수로 넘기므로 state · plan 에 남지 않는다.
# --inputs-debug 는 값을 파일(terragrunt-debug.tfvars.json)로 쓰므로 쓰지 않는다.
#
# .env 가 없거나 항목이 비면 빈 값으로 둔다. run --all 이 이 파일을 파싱할 때 실패하지 않고, apply 때는 variables.tf 검증이 막는다
locals {
  env_file = "${get_terragrunt_dir()}/.env"

  # KEY=value 줄만 읽는다 (주석 · 빈 줄 무시, 값 양끝 따옴표 제거)
  env = fileexists(local.env_file) ? {
    for m in regexall("(?m)^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", file(local.env_file)) :
    m[0] => trimsuffix(trimprefix(trimspace(m[1]), "\""), "\"")
  } : {}

  # PEM 은 여러 줄이라 .env 에는 경로(절대 경로 또는 ~)만 둔다
  github_app_private_key_file = pathexpand(lookup(local.env, "GITHUB_APP_PRIVATE_KEY_FILE", ""))
}

inputs = {
  github_app_id              = lookup(local.env, "GITHUB_APP_ID", "")
  github_app_installation_id = lookup(local.env, "GITHUB_APP_INSTALLATION_ID", "")
  github_app_private_key = (
    local.github_app_private_key_file != "" && fileexists(local.github_app_private_key_file)
    ? file(local.github_app_private_key_file) : ""
  )

  toss_secret_key = lookup(local.env, "TOSS_SECRET_KEY", "")
  toss_client_key = lookup(local.env, "TOSS_CLIENT_KEY", "")

  seed_admin_email    = lookup(local.env, "SEED_ADMIN_EMAIL", "")
  seed_admin_password = lookup(local.env, "SEED_ADMIN_PASSWORD", "")
  seed_admin_name     = lookup(local.env, "SEED_ADMIN_NAME", "")

  grafana_admin_password = lookup(local.env, "GRAFANA_ADMIN_PASSWORD", "")
}
