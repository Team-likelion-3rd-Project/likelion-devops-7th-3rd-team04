output "state_bucket_name" {
  description = "다른 스택의 backend \"gcs\" 설정에 사용할 버킷 이름"
  value       = google_storage_bucket.tfstate.name
}
