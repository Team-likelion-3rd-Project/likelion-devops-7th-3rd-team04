# 다른 스택은 dependency.pod_roles.outputs.<이름> 처럼 읽는다.
# 계정 ID 가 로그에 찍히지 않도록 Role ARN 은 output 하지 않는다 (72 Pod Identity Association 은 이름으로 ARN 을 만든다)

output "pod_role_bindings" {
  description = "Role 키 → { role_name, namespace, service_account } (72 Pod Identity Association · 매핑 대조용)"
  value = {
    for k, r in local.pod_roles : k => {
      role_name       = aws_iam_role.pod[k].name
      namespace       = r.namespace
      service_account = r.service_account
    }
  }
}
