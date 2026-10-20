include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. 직접 destroy 해도 막는다
prevent_destroy = true

# 값(ephemeral 변수)을 넣을 때만 이 디렉터리에서 직접 apply 한다 (README 5절).
# run --all 은 env 없이 돌므로 변수 검증에 걸리지 않게 apply · destroy · plan 모두에서 뺀다
exclude {
  if      = true
  actions = ["all"]
}
