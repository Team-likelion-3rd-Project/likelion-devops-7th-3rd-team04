output "cluster_name" {
  description = "EKS 클러스터 이름 (aws eks update-kubeconfig --name <이름>)"
  value       = aws_eks_cluster.this.name
}

output "node_group_names" {
  description = "Managed Node Group 이름 (platform · 가용 영역별 app)"
  value = {
    platform = aws_eks_node_group.platform.node_group_name
    app      = { for az, ng in aws_eks_node_group.app : az => ng.node_group_name }
  }
}
