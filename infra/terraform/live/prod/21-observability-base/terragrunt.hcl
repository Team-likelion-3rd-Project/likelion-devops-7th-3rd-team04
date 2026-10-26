include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 다른 스택에 의존하지 않는다. 로그 그룹을 쓰는 Fluent Bit IRSA Role 은 70 이 output 으로 받아 만든다
