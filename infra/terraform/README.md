# Terraform

AWS 운영 환경(`us-east-1`)을 구성하는 Terraform 코드입니다.
스택을 왜 이렇게 나눴는지, 스택 사이의 의존 관계는 위키 [**AWS 인프라 Terraform 스택 설계**](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/wiki/AWS-%EC%9D%B8%ED%94%84%EB%9D%BC-Terraform-%EC%8A%A4%ED%83%9D-%EC%84%A4%EA%B3%84) 를 보세요.

- 자격 증명: [`aws-login.sh`](aws-login.sh) 로 `team04` 프로필에 로그인한 뒤 실행합니다.
- **모든 terraform 명령 앞에 `AWS_PROFILE=team04` 를 붙입니다.** 붙이지 않으면 기본 프로필(다른 계정)로 실행됩니다.
  ```bash
  AWS_PROFILE=team04 terraform init -backend-config=../backend.hcl
  AWS_PROFILE=team04 terraform plan
  AWS_PROFILE=team04 terraform apply

  # 또는 터미널 세션 단위로 지정
  export AWS_PROFILE=team04
  ```
- 버전: Terraform `>= 1.11`, AWS provider `~> 6.0`. `.terraform.lock.hcl` 은 커밋합니다.

---

## 1. 디렉터리 구조

```
infra/terraform/
├── aws-login.sh
├── modules/                         # 재사용 모듈
│   └── vpc/                         # VPC, 계층별 서브넷, IGW, NAT, 라우트 테이블, 게이트웨이 엔드포인트, Flow Logs
└── live/
    ├── bootstrap/                   🔒 state 버킷
    └── prod/
        ├── backend.hcl              # 공통 backend 설정
        ├── 10-global/               🔒
        ├── 11-registry/             🔒
        ├── 20-network/              🔁
        ├── 21-observability-base/   🔁
        ├── 30-security/             🔁
        ├── 40-cicd/                 🔁
        ├── 41-main-data/            🔁
        ├── 42-payment-data/         🔁
        ├── 43-messaging/            🔁
        ├── 44-payment-endpoints/    🔁
        ├── 50-payment-webhook/      🔁
        ├── 60-payment-app/          🔁
        ├── 70-main-cluster-kubeadm/ 🔁
        ├── 80-main-edge/            🔁
        ├── 81-frontend/             🔁
        ├── 82-gcp-llm/              🔁
        └── 90-observability-alarms/ 🔁
```

🔒 상시 유지 (destroy 하지 않음) / 🔁 매일 재생성

---

## 2. 번호 규칙

- **십의 자리 = 단계, 일의 자리 = 같은 단계 안의 순번** 입니다. 디렉터리 정렬 순서가 곧 apply 순서입니다.
- **앞자리가 같은 스택은 서로 참조하지 않습니다.** 병렬로 apply 할 수 있습니다.
- **스택은 앞자리가 더 작은 스택만 참조할 수 있습니다.** 역방향 참조는 리뷰에서 반려합니다.
- 같은 단계에 스택을 추가하면 일의 자리만 늘립니다 (예: `44-...`).

---

## 3. state 와 backend

state 는 `team04-hotel-tfstate` 버킷에 저장하고, 락은 S3 네이티브 락(`use_lockfile`)을 씁니다.
state key 에는 **디렉터리 번호를 넣지 않습니다.** 번호가 바뀌어도 state 를 옮기지 않기 위해서입니다.

| 스택 | state key |
|---|---|
| `live/bootstrap` | `bootstrap/terraform.tfstate` |
| `live/prod/<번호>-<스택>` | `prod/<스택>/terraform.tfstate` (예: `prod/network/terraform.tfstate`) |

새 스택은 `backend.tf` 에 key 만 적고, 나머지는 공통 `backend.hcl` 로 넘깁니다.

```hcl
# live/prod/20-network/backend.tf
terraform {
  backend "s3" {
    key = "prod/network/terraform.tfstate"
  }
}
```

```bash
cd infra/terraform/live/prod/20-network
AWS_PROFILE=team04 terraform init -backend-config=../backend.hcl
```

---

## 4. apply / destroy 순서

```
bootstrap                                  🔒 최초 1회
10-global   11-registry                    🔒 최초 1회, 이후 변경 시에만
─────────────────────── 매일 재생성 ───────────────────────
20-network   21-observability-base
30-security
40-cicd   41-main-data   42-payment-data   43-messaging   44-payment-endpoints
50-payment-webhook
60-payment-app
70-main-cluster-kubeadm
80-main-edge   81-frontend   82-gcp-llm
90-observability-alarms
```

- **apply:** `20` → `90` (번호 오름차순)
- **destroy:** `90` → `20` (번호 내림차순)
- `10-global` 은 도메인 없이 apply 할 수 있습니다. 도메인 구매 후 절차는 구매 계정(운영 계정 / 다른 계정)에 따라 다르며 [`dns.tf`](live/prod/10-global/dns.tf) 상단 주석을 따릅니다.
- `bootstrap`, `10-global`, `11-registry` 는 **destroy 하지 않습니다.**
  Hosted Zone 을 다시 만들면 NS 가 바뀌고, Object Lock 로그 버킷은 잠긴 객체가 남아 있으면 삭제할 수 없고, OIDC 발급자가 바뀌면 IRSA 신뢰 정책이 깨지고, ECR 을 지우면 이미지가 사라집니다.

### 스택별 소요 시간

빈 상태에서 apply, 전체 destroy 기준 실측값입니다.

| 스택 | 조건 | apply | destroy |
|---|---|---|---|
| `20-network` | `single_nat_gateway = true` (NAT 3개, 기본값) | 2분 13초 | 1분 52초 |
| `20-network` | `single_nat_gateway = false` (NAT 5개) | 2분 27초 | 1분 23초 |
| `30-security` | `enable_control_plane = true` (SG 6개, 규칙 23개) | 14초 | 15초 |
| `70-main-cluster-kubeadm` | CP 3대, 워커 2대, user-data 없음 | 2분 55초 | 1분 26초 |

---

## 5. 매일 재생성 스택 작성 규칙

🔁 스택은 매일 destroy 되므로 아래 설정을 지켜야 destroy / 재생성이 실패하지 않습니다.

| 대상 | 설정 |
|---|---|
| Secrets Manager | `recovery_window_in_days = 0` |
| RDS | `skip_final_snapshot = true`, `deletion_protection = false` |
| S3 | `force_destroy = true` |

🔒 스택의 리소스에는 `prevent_destroy = true` 를 겁니다.

---

## 6. `70-main-cluster-kubeadm` 부트스트랩 확인

CP 3대는 apply 가 끝난 뒤 user-data 가 [`infra/ansible/aws-control-plane.yml`](../ansible/aws-control-plane.yml) 을 실행해 클러스터를 구성합니다 ([Ansible README](../ansible/README.md) 12절).
**terraform apply 가 성공해도 부트스트랩은 그 뒤 몇 분 더 걸리고, 실패해도 apply 결과에 나타나지 않습니다.**

```bash
# 인스턴스 ID 확인 → SSM 접속 (SSM 은 키 페어 · 22 포트 없이 접속)
AWS_PROFILE=team04 terraform output control_plane_instance_ids
AWS_PROFILE=team04 aws ssm start-session --target <인스턴스 ID>

# 노드 안에서
sudo tail -f /var/log/cloud-init-output.log        # user-data · Ansible 출력. 마지막 줄 "[bootstrap] 완료" 면 성공
cloud-init status --long                           # status: done / error
sudo kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes -o wide
```

- CP-b · c 로그가 `CA cert hash 기록 대기` 에서 멈춰 있으면 CP-a 의 로그를 먼저 봅니다.
- Ansible 묶음을 고친 뒤 apply 하면 S3 객체만 바뀌고, 이미 떠 있는 CP 에는 반영되지 않습니다 (user-data 는 첫 부팅에만 실행). 다시 확인하려면 스택을 destroy → apply 합니다.
