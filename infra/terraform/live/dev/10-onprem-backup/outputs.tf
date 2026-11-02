output "bucket_name" {
  description = "백업 버킷 이름 (ansible etcd_backup_bucket)"
  value       = aws_s3_bucket.backup.bucket
}

output "bucket_arn" {
  description = "백업 버킷 ARN"
  value       = aws_s3_bucket.backup.arn
}

output "backup_user_name" {
  description = "온프레미스 백업 IAM user. access key 는 apply 후 CLI 로 직접 발급한다 (README.md)"
  value       = aws_iam_user.backup.name
}

output "backup_user_arn" {
  description = "온프레미스 백업 IAM user ARN"
  value       = aws_iam_user.backup.arn
}
