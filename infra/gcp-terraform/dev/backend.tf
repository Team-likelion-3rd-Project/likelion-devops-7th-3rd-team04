# bucket 은 bootstrap 스택의 state_bucket_name output.
# backend 블록에는 변수를 쓸 수 없어 impersonation 도 여기에 직접 적습니다.
terraform {
  backend "gcs" {
    bucket                      = "likelion-devops-7th-3rd-team4-tfstate"
    prefix                      = "dev"
    impersonate_service_account = "terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com"
  }
}
