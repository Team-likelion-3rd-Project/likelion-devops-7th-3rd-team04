# 다른 스택은 dependency.network.outputs.<vpc>.subnet_ids.<계층> 처럼 읽는다.
#   main.subnet_ids       : public / worker / cp (enable_control_plane_subnets) / db
#   payment.subnet_ids    : public / lb / app / db, payment.gateway_endpoint_ids.s3 는 44-payment-endpoints 가 정책을 붙인다
#   deployment.subnet_ids : public / runner

output "main" {
  description = "Main VPC (vpc_id, vpc_cidr, subnet_ids, subnet_ids_by_az, route_table_ids, nat_public_ips)"
  value = {
    vpc_id           = module.main.vpc_id
    vpc_cidr         = module.main.vpc_cidr
    subnet_ids       = module.main.subnet_ids
    subnet_ids_by_az = module.main.subnet_ids_by_az
    route_table_ids  = module.main.route_table_ids
    nat_public_ips   = module.main.nat_public_ips
  }
}

output "payment" {
  description = "Payment VPC (vpc_id, vpc_cidr, subnet_ids, subnet_ids_by_az, route_table_ids, nat_public_ips, gateway_endpoint_ids)"
  value = {
    vpc_id               = module.payment.vpc_id
    vpc_cidr             = module.payment.vpc_cidr
    subnet_ids           = module.payment.subnet_ids
    subnet_ids_by_az     = module.payment.subnet_ids_by_az
    route_table_ids      = module.payment.route_table_ids
    nat_public_ips       = module.payment.nat_public_ips
    gateway_endpoint_ids = module.payment.gateway_endpoint_ids
  }
}

output "deployment" {
  description = "Deployment VPC (vpc_id, vpc_cidr, subnet_ids, subnet_ids_by_az, route_table_ids, nat_public_ips)"
  value = {
    vpc_id           = module.deployment.vpc_id
    vpc_cidr         = module.deployment.vpc_cidr
    subnet_ids       = module.deployment.subnet_ids
    subnet_ids_by_az = module.deployment.subnet_ids_by_az
    route_table_ids  = module.deployment.route_table_ids
    nat_public_ips   = module.deployment.nat_public_ips
  }
}
