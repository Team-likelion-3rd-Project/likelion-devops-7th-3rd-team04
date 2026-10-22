include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 상시 유지 스택. run --all destroy 대상에서 빼고, 이 디렉터리에서 직접 destroy 해도 막는다
# (CloudFront 생성 · 삭제가 느리고, 사이트 릴리스 · 객실 사진은 매일 재생성과 무관하게 남아야 한다)
prevent_destroy = true

exclude {
  if      = true
  actions = ["destroy"]
}

# 같은 1x 단계인 10-global 은 dependency 로 참조하지 않는다 (번호 규칙).
# Zone · 인증서는 도메인 이름으로 data source 조회 (main.tf)
