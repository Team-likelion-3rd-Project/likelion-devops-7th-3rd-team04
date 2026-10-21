# auth-service 리프레시 토큰 저장소. 앱(ioredis)은 클러스터 모드를 지원하지 않으므로 클러스터 모드 비활성 복제 그룹으로 만든다.
# 앱 환경 변수: REDIS_HOST, REDIS_PASSWORD(AUTH 토큰), REDIS_TLS=true

resource "aws_elasticache_subnet_group" "main" {
  name        = "${local.name}-valkey"
  description = "Main ElastiCache Valkey"
  subnet_ids  = var.db_subnet_ids
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = local.name
  description          = "Main ElastiCache Valkey"

  engine               = "valkey"
  engine_version       = var.valkey_engine_version
  node_type            = var.valkey_node_type
  parameter_group_name = "default.valkey${split(".", var.valkey_engine_version)[0]}"
  port                 = 6379

  num_cache_clusters         = var.valkey_num_nodes
  automatic_failover_enabled = var.valkey_num_nodes > 1
  multi_az_enabled           = var.valkey_num_nodes > 1

  subnet_group_name  = aws_elasticache_subnet_group.main.name
  security_group_ids = [var.sg_ids["main_valkey"]]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  transit_encryption_mode    = "required"

  # credentials_version 을 올리면 기본 전략(ROTATE)으로 새 토큰을 추가한다. 이전 토큰도 계속 유효해 ESO 갱신 전 앱이 끊기지 않는다
  auth_token_wo         = ephemeral.aws_secretsmanager_random_password.valkey.random_password
  auth_token_wo_version = var.credentials_version

  snapshot_retention_limit   = 0
  auto_minor_version_upgrade = true
  apply_immediately          = true

  tags = {
    Name = local.name
  }
}
