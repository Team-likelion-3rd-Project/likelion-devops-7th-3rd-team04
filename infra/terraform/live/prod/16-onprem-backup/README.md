# 16-onprem-backup — 온프레미스 etcd 백업 버킷 (Terraform 담당자 전달 사항)

> **아직 apply 하지 않았습니다.** 코드는 작성자가 `terraform fmt` · `terraform validate`(backend 없이)까지만 확인했습니다. `plan` 결과 검토와 apply 는 Terraform 담당자가 진행해 주세요.

## 1. 목적 · 범위

온프레미스 dev 클러스터(kubeadm 단일 CP)에는 지금까지 백업이 없었습니다. 이 스택은 CP 의 **etcd snapshot + `/etc/kubernetes/pki` + `admin.conf`** 를 하루 한 번 보관할 S3 버킷과, 온프레미스 노드가 올릴 때 쓰는 IAM user 를 만듭니다.

- 노드 쪽(업로드 timer)은 [`infra/ansible/roles/etcd_backup`](../../../../ansible/roles/etcd_backup) · [ansible README 18절](../../../../ansible/README.md#18-etcd-백업-aws-s3)
- **DB 는 올리지 않습니다.** dev DB 는 시딩으로 다시 만들기로 팀에서 합의했습니다. 로그는 Loki 가 맡습니다.
- 객체는 노드에서 **age 로 암호화한 뒤** 올라옵니다. 버킷을 읽을 수 있어도 개인키(팀 password manager) 없이는 내용을 볼 수 없습니다.

## 2. 만드는 리소스

| 리소스 | 이름 | 설정 |
|---|---|---|
| S3 버킷 | `team04-hotel-onprem-backup` (`bucket_name`) | `prevent_destroy`, BucketOwnerEnforced, 공개 차단 4개, SSE-S3, **versioning 켬** |
| 수명 주기 | — | 30일 뒤 만료(`retention_days`) → 이전 버전 7일 뒤 삭제(`noncurrent_retention_days`), 만료된 delete marker 정리, 미완료 multipart 7일 |
| 버킷 정책 | — | TLS 강제. **쓰기 · 삭제는 백업 user · apply 주체 · `admin_role_names` 만** (공유 계정의 다른 주체가 지우지 못하게. 13-frontend 와 같은 방식) |
| IAM user | `team04-hotel-onprem-backup` | inline 정책: `etcd/*` 에 `s3:PutObject` · `s3:AbortMultipartUpload` 만. 읽기 · 목록 · 삭제 없음 |

- **`aws_iam_access_key` 는 만들지 않습니다.** secret 이 state 에 남기 때문입니다 (README 5절 규칙). 키는 apply 후 4절대로 CLI 로 발급합니다.
- 온프레미스는 OIDC · 인스턴스 Role 을 쓸 수 없어 IAM user 를 둡니다. 다른 스택은 참조하지 않습니다 (dependency 없음).
- state key: `prod/onprem-backup/terraform.tfstate`
- 비용: snapshot 수십 MB × 하루 1개 × 30일 수준이라 월 몇 센트입니다.

## 3. 적용

```bash
cd infra/terraform/live/prod/16-onprem-backup
AWS_PROFILE=team04 terragrunt plan     # 버킷 · 버전 관리 · 수명 주기 · 공개 차단 · 암호화 · 소유권 · 정책 · IAM user · user 정책
AWS_PROFILE=team04 terragrunt apply
```

`run --all apply` 에도 포함되고, `run --all destroy` 에서는 빠집니다 (`exclude`, 🔒 상시 스택).

## 4. apply 후 할 일 (access key 발급 → OpenBao)

키 값이 화면 · 셸 기록에 남지 않게 파이프로 바로 OpenBao 에 넣습니다. OpenBao 접근은 ansible README 16-4 와 같습니다 (`.secrets/openbao.env` 를 source 한 팀원 PC).

```bash
export BAO_ADDR=$OPENBAO_ADDR BAO_TOKEN=$OPENBAO_TOKEN
AWS_PROFILE=team04 aws iam create-access-key --user-name team04-hotel-onprem-backup \
  --query 'AccessKey.{access_key_id:AccessKeyId,secret_access_key:SecretAccessKey}' --output json \
  | bao kv put secret/team04-hotel/dev/aws-backup -
bao kv get -field=access_key_id secret/team04-hotel/dev/aws-backup   # 들어갔는지 확인 (ID 만)
```

그다음 CP 담당자가 `ansible-playbook control-plane.yml --tags etcd_backup` 을 실행합니다 (ansible README 18-1).

- `aws-backup` 은 ESO 정책(`eso-dev`)에 넣지 않습니다. 클러스터는 이 키를 읽을 수 없습니다.
- **키 교체:** 새 키를 같은 방법으로 발급해 OpenBao 를 덮어씀 → `control-plane.yml --tags etcd_backup` → 다음 백업 성공 확인 → `aws iam delete-access-key --user-name team04-hotel-onprem-backup --access-key-id <이전 ID>`. IAM user 는 키를 2개까지 가질 수 있습니다.

## 5. 담당자가 확인해 주실 것

- [ ] **`admin_role_names`**: 백업을 직접 지우거나 올려야 할 관리자 Role(SSO 등)이 있으면 넣어 주세요. 비워 두면 백업 user 와 apply 한 주체(Role)만 쓰기 · 삭제할 수 있습니다. 읽기(복구용 다운로드)는 막지 않습니다.
- [ ] 버킷 이름 `team04-hotel-onprem-backup` 이 계정 · 전역에서 충돌하지 않는지
- [ ] 보존 기간(30일 + 이전 버전 7일)이 괜찮은지
- [ ] 공유 계정의 IAM user 생성 규칙(path, 태그, 키 사용 금지 정책 등)에 걸리지 않는지
- [ ] `.terraform.lock.hcl` 은 `15-chatbot-vectors` 와 같은 aws provider 버전으로 복사했습니다. 처음 `init` 때 플랫폼 해시가 추가되면 함께 커밋해 주세요
- [ ] apply 후 확인: `aws s3api get-bucket-policy --bucket team04-hotel-onprem-backup`, `aws iam list-user-policies --user-name team04-hotel-onprem-backup`

## 6. 바꿀 때 함께 바꿀 곳

| Terraform 변수 | 같이 바꿀 곳 |
|---|---|
| `bucket_name` | `infra/ansible/roles/etcd_backup/defaults/main.yml` 의 `etcd_backup_bucket` |
| `backup_prefix` (`etcd`) | 같은 파일 `etcd_backup_prefix` 의 첫 구간 (`etcd/onprem-dev`) |
| region (`us-east-1`) | 같은 파일 `etcd_backup_region` |
