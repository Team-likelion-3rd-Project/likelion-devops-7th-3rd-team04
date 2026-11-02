output "cluster_name" {
  description = "EKS 클러스터 이름 (aws eks update-kubeconfig --name <이름>)"
  value       = aws_eks_cluster.this.name
}

output "node_group_name" {
  description = "Managed Node Group 이름"
  value       = aws_eks_node_group.worker.node_group_name
}
