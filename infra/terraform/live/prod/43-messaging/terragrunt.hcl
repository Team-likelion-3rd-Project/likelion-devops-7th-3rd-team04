include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 다른 스택에 의존하지 않는다. 큐 정책은 사용하는 쪽 Role 을 고정 이름으로 참조한다 (main.tf)
