# prod 스택 공통 backend 설정. 각 스택의 backend.tf 에는 key 만 적는다.
#   terraform init -backend-config=../backend.hcl
bucket       = "team04-hotel-tfstate"
region       = "us-east-1"
encrypt      = true
use_lockfile = true
