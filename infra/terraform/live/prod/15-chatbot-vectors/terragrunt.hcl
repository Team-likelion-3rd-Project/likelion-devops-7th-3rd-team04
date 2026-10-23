include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. run --all destroy 대상에서 빼고, 이 디렉터리에서 직접 destroy 해도 막는다
# (RAG 인덱스는 문서 임베딩 결과라 매일 다시 만들 이유가 없다. 적재 Job 은 릴리스마다 같은 key 로 덮어쓴다)
prevent_destroy = true

exclude {
  if      = true
  actions = ["destroy"]
}
