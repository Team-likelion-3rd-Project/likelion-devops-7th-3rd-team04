include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. run --all destroy 대상에서 빼고, 이 디렉터리에서 직접 destroy 해도 막는다
prevent_destroy = true

exclude {
  if      = true
  actions = ["destroy"]
}
