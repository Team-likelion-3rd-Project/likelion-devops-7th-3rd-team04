# 다른 스택은 data.terraform_remote_state.main_cluster.outputs.<이름> 처럼 읽는다.

output "apiserver_endpoint" {
  description = "kube-apiserver 내부 NLB DNS 이름 (kubeadm controlPlaneEndpoint, 포트 6443)"
  value       = aws_lb.apiserver.dns_name
}

output "control_plane_instance_ids" {
  description = "AZ 접미사 → CP 인스턴스 ID (SSM 접속 · 포트포워딩용)"
  value       = { for az, i in aws_instance.cp : az => i.id }
}

output "worker_asg_name" {
  description = "워커 ASG 이름 (80-main-edge 가 ALB Target Group 을 연결)"
  value       = aws_autoscaling_group.worker.name
}
