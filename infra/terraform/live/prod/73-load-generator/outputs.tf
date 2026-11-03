# 80-main-edge 가 WAF rate limit 예외로 읽는다. 꺼져 있으면 빈 목록이라 예외가 없다.
# null 대신 빈 목록인 이유: null output 은 state 에 키가 남지 않아 80 의 dependency 가 읽을 값이 없다

output "waf_exempt_cidrs" {
  description = "WAF rate limit 예외 출발지 (부하 생성기 EIP /32, enable_load_generator = false 면 [])"
  value       = [for eip in aws_eip.generator : "${eip.public_ip}/32"]
}

output "instance_id" {
  description = "Session Manager 접속 대상 (aws ssm start-session --target <id>, 꺼져 있으면 null)"
  value       = one(aws_instance.generator[*].id)
}
