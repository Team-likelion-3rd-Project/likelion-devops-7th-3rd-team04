include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택 (live/dev — live/prod run --all 과 무관). live/dev 의 run --all destroy 대상에서 빼고, 이 디렉터리에서 직접 destroy 해도 막는다
# (온프레미스 etcd 백업은 AWS 쪽 매일 재생성과 무관하게 남아야 한다)
prevent_destroy = true

exclude {
  if      = true
  actions = ["destroy"]
}

# 다른 스택을 참조하지 않는다. 담당자 전달 사항은 README.md
