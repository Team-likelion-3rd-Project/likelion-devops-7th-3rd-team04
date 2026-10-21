# 다른 스택은 dependency.security.outputs.sg_ids.<vpc>_<역할> 처럼 읽는다.
# enable_control_plane = false 면 main_cp, main_internal_nlb 는 null

output "sg_ids" {
  description = "SG ID (main_alb, main_worker, main_cp, main_internal_nlb, main_db, main_valkey, payment_app, payment_db, payment_vpce, deployment_runner)"
  value = merge(
    {
      main_cp           = null
      main_internal_nlb = null
    },
    { for k, sg in aws_security_group.this : k => sg.id },
  )
}
