# infra/gcp-terraform — 챗봇 Vertex AI 용 GCP 구성

온프레미스 dev 클러스터의 llm-service 가 GCP Vertex AI(Gemini · 임베딩)를 호출하는 데 필요한 GCP 리소스입니다. AWS 쪽(`infra/terraform`)과 state 를 섞지 않도록 디렉터리와 state 버킷(GCS)을 따로 둡니다.

| 스택 | 내용 | state |
|---|---|---|
| `bootstrap/` | state 버킷 `likelion-devops-7th-3rd-team4-tfstate`, IAM Credentials API | **로컬** (자기가 만들 버킷에 state 를 둘 수 없음) |
| `dev/` | IAM API 활성화, 서비스 계정 `llm-service-dev`, `roles/aiplatform.user` 부여 | GCS `dev/` |

- AWS 운영 클러스터용 GCP 구성(키 없는 Workload Identity Federation, 서비스 계정 `llm-service-prod`)은 여기가 아니라 Terragrunt 유닛 [`infra/terraform/live/prod/14-gcp-llm`](../terraform/README.md) 에 있습니다 (state 는 AWS S3).
- 프로젝트: `likelion-devops-7th-3rd-team4` / 기본 리전: `asia-northeast3`
- 서비스 계정 **키는 Terraform 으로 만들지 않습니다.** `google_service_account_key` 로 만들면 비밀키가 state 에 평문으로 남기 때문입니다. 아래 "키 발급" 처럼 gcloud 로 따로 발급합니다.

## 0. 인증 — 사람 계정으로 terraform 서비스 계정을 impersonate

키 파일 없이 본인 Google 계정(ADC)으로 `terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com` 을 impersonate 해서 실행합니다. 본인 계정에 그 서비스 계정의 **Service Account Token Creator** 권한이 있어야 합니다(프로젝트 관리 담당자가 부여).

```bash
gcloud auth application-default login     # Terraform 이 쓰는 ADC
gcloud auth login                         # gcloud CLI 명령(키 발급)용 — ADC 와 별개
```

terraform 서비스 계정은 `roles/editor` 와 **조건부** `roles/resourcemanager.projectIamAdmin`(조건 `terraform-grant-vertex-only`: `roles/aiplatform.user` 만 부여·회수 가능)을 가집니다. 그래서 IAM 은 다른 바인딩을 건드리지 않는 `google_project_iam_member` 로만 관리합니다(`_binding` / `_policy` 금지). 다른 역할을 부여해야 하면 프로젝트 관리 담당자에게 조건의 `hasOnly([...])` 목록 확장을 요청합니다.

## 1. bootstrap (최초 1회)

```bash
cd infra/gcp-terraform/bootstrap
terraform init
terraform apply
```

- 로컬 state(`terraform.tfstate`, gitignore)를 잃어버리면 `terraform import google_storage_bucket.tfstate likelion-devops-7th-3rd-team4-tfstate` 로 복구합니다.
- 버킷은 버저닝 · uniform access · public access prevention 이 켜져 있고 `prevent_destroy` 입니다.

## 2. dev

```bash
cd infra/gcp-terraform/dev
terraform init      # backend "gcs" (bucket = bootstrap 의 state 버킷, prefix = dev)
terraform plan
terraform apply
terraform output llm_service_account_email
```

## 3. 키 발급 (Terraform 밖)

```bash
gcloud iam service-accounts keys create infra/ansible/.secrets/llm-service-dev-sa.json \
  --iam-account=llm-service-dev@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com \
  --impersonate-service-account=terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com
chmod 600 infra/ansible/.secrets/llm-service-dev-sa.json
```

- `infra/ansible/.secrets/` 는 gitignore 대상입니다. 절대 커밋하지 않습니다.
- `infra/ansible/.env` 의 `GCP_SA_KEY_FILE` 이 이 파일을 가리키고, `k8s-cicd.yml` 이 내용을 `backend-secrets` 의 `GCP_SA_KEY_JSON` 으로 넣습니다(`infra/ansible/README.md` 15절).
- 새 키는 전파에 1분 정도 걸립니다. 그 사이 Vertex 호출은 `401 UNAUTHENTICATED` 가 날 수 있습니다.
- 로컬에서 키 확인:
  ```bash
  cd langchain_rag/llm-service
  LLM_PROVIDER=vertex GCP_PROJECT_ID=likelion-devops-7th-3rd-team4 VECTOR_STORE=none \
  GCP_SA_KEY_JSON="$(cat ../../infra/ansible/.secrets/llm-service-dev-sa.json)" \
  python -c "import asyncio; from app import retrieval; print(len(asyncio.run(retrieval.embed_query('test'))))"   # 768
  ```

### 키 교체

```bash
SA=llm-service-dev@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com
IMP=--impersonate-service-account=terraform@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com
gcloud iam service-accounts keys list --iam-account=$SA --managed-by=user $IMP     # 기존 키 ID
# 위 "키 발급" 으로 새 키 → k8s-cicd.yml --tags backend_secrets → llm-service 재기동 확인 후
gcloud iam service-accounts keys delete <기존 키 ID> --iam-account=$SA $IMP
```
