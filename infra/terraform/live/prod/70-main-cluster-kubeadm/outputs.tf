# 다른 스택은 dependency.main_cluster.outputs.<이름> 처럼 읽는다.

output "apiserver_endpoint" {
  description = "kube-apiserver 내부 NLB DNS 이름 (kubeadm controlPlaneEndpoint, 포트 6443)"
  value       = aws_lb.apiserver.dns_name
}

output "control_plane_asg_names" {
  description = "AZ 접미사 → CP ASG 이름 (인스턴스 ID 조회 → SSM 접속, README 6절)"
  value       = { for az, g in aws_autoscaling_group.cp : az => g.name }
}

output "worker_asg_name" {
  description = "워커 ASG 이름 (80-main-edge 가 ALB Target Group 을 연결)"
  value       = aws_autoscaling_group.worker.name
}
