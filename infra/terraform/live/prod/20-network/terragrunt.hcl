include "root" {
  path = find_in_parent_folders("root.hcl")
}

# 🔒 10-global 은 destroy 하지 않으므로 mock 없이 실제 output 을 읽는다
dependency "global" {
  config_path = "../10-global"
}

inputs = {
  log_bucket_arn  = dependency.global.outputs.log_bucket_arn
  log_bucket_name = dependency.global.outputs.log_bucket_name
}
