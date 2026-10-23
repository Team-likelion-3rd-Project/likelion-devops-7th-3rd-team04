# Terraform

AWS 운영 환경(`us-east-1`)을 구성하는 Terraform 코드입니다.
스택을 왜 이렇게 나눴는지, 스택 사이의 의존 관계는 위키 [**AWS 인프라 Terraform 스택 설계**](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/wiki/AWS-%EC%9D%B8%ED%94%84%EB%9D%BC-Terraform-%EC%8A%A4%ED%83%9D-%EC%84%A4%EA%B3%84) 를 보세요.

- `live/prod` 스택은 [Terragrunt](https://terragrunt.gruntwork.io/) 로 실행합니다. `live/bootstrap` 만 `terraform` 으로 실행합니다 (로컬 state).
- 자격 증명: [`aws-login.sh`](aws-login.sh) 로 `team04` 프로필에 로그인한 뒤 실행합니다.
- **모든 명령 앞에 `AWS_PROFILE=team04` 를 붙입니다.** 붙이지 않으면 기본 프로필(다른 계정)로 실행됩니다.
  ```bash
  # 터미널 세션 단위로 지정 (TG_PROVIDER_CACHE 는 4절)
  export AWS_PROFILE=team04 TG_PROVIDER_CACHE=1
  ```
- `14-gcp-llm` 은 GCP 리소스를 만들어 **gcloud ADC 도 필요합니다** (`run --all` 에 포함). 본인 Google 계정에 terraform 서비스 계정의 Token Creator 권한이 있어야 합니다 ([`infra/gcp-terraform/README.md`](../gcp-terraform/README.md) 0절).
  ```bash
  gcloud auth application-default login
  ```
- 버전: Terraform `>= 1.11`, Terragrunt `>= 1.1`, AWS provider `~> 6.0`, Google provider `~> 8.5`. `.terraform.lock.hcl` 은 커밋합니다.

---

## 1. 디렉터리 구조

```
infra/terraform/
├── aws-login.sh
├── modules/                         # 재사용 모듈
│   └── vpc/                         # VPC, 계층별 서브넷, IGW, NAT, 라우트 테이블(선택: NFW 경유), 게이트웨이 엔드포인트, Flow Logs
└── live/
    ├── bootstrap/                   🔒 state 버킷
    └── prod/
        ├── root.hcl                 # 공통 설정 (backend · provider 생성, state key 계산)
        ├── 10-global/               🔒
        ├── 11-registry/             🔒
        ├── 12-secrets/              🔒 외부에서 발급한 비밀값 (값 등록 때만 직접 apply)
        ├── 13-frontend/             🔒 프론트 · 객실 사진 (S3 · CloudFront · KeyValueStore)
        ├── 14-gcp-llm/              🔒 챗봇 Vertex AI 인증 (GCP Workload Identity Federation)
        ├── 20-network/              🔁
        ├── 21-observability-base/   🔁
        ├── 30-security/             🔁
        ├── 40-cicd/                 🔁
        ├── 41-main-data/            🔁
        ├── 42-payment-data/         🔁
        ├── 43-messaging/            🔁
        ├── 44-payment-endpoints/    🔁
        ├── 50-payment-webhook/      🔁
        ├── 60-payment-app/          🔁 결제 서버 · NLB · Endpoint Service
        ├── 61-payment-mock/         🔁 부하 테스트용 pg-mock 인스턴스
        ├── 70-main-cluster-kubeadm/ 🔁
        ├── 71-payment-link/         🔁 메인 VPC 결제 PrivateLink 엔드포인트 · 고정 이름
        ├── 80-main-edge/            🔁
        └── 90-observability-alarms/ 🔁
```

🔒 상시 유지 (destroy 하지 않음) / 🔁 매일 재생성

각 스택 디렉터리는 `*.tf` 와 `terragrunt.hcl` 로 이루어집니다. `backend.tf` · `providers.tf` 는 두지 않습니다 (`root.hcl` 이 생성). AWS 리소스가 없는 `14-gcp-llm` 은 `root.hcl` 의 `non_aws_stacks` 로 AWS provider 생성을 끄고, 자기 `terragrunt.hcl` 에서 google provider 를 생성합니다.

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

`root.hcl` 이 디렉터리 이름에서 번호를 뗀 값(`20-network` → `network`)으로 state key 와 `Stack` 태그를 정하고, backend · provider 블록을 생성합니다.

### 새 스택 추가

1. `live/prod/<번호>-<스택>/` 에 `*.tf` (`versions.tf`, `variables.tf` 의 `project` · `environment` · `region` 포함) 를 작성합니다.
2. `terragrunt.hcl` 을 추가합니다. 다른 스택 output 은 `dependency` 로 받아 변수로 넘깁니다 (`terraform_remote_state` 는 쓰지 않습니다).

```hcl
# live/prod/30-security/terragrunt.hcl
include "root" {
  path = find_in_parent_folders("root.hcl")
}

dependency "network" {
  config_path = "../20-network"

  # 인프라가 내려가 있을 때(output 없음) plan · validate · destroy 를 돌리기 위한 값
  mock_outputs = {
    main = { vpc_id = "vpc-00000000000000000" }
  }
  mock_outputs_allowed_terraform_commands = ["init", "validate", "plan", "destroy"]
}

inputs = {
  main_vpc_id = dependency.network.outputs.main.vpc_id
}
```

- 🔁 스택을 참조하면 `mock_outputs` 를 넣습니다. 받는 쪽 변수 타입에 맞춰 쓰는 속성만 채웁니다. 🔒 스택(`10-global`)은 항상 떠 있으므로 넣지 않습니다.
- 값이 null 인 output(예: 도메인 구매 전 `10-global` 의 `zone_id`)은 state 에 저장되지 않아 키가 없습니다. `try(dependency.global.outputs.zone_id, null)` 로 받습니다.

### 캐시 디렉터리

Terragrunt 는 스택을 `.terragrunt-cache/` 로 복사해 실행합니다. 스택 밖 상대 경로(`../../../modules/vpc`, `70` 의 `../../../../ansible`)가 깨지지 않도록 `root.hcl` 의 `source` 가 `infra/` 전체를 복사합니다. `.terragrunt-cache/` 는 gitignore 되어 있고, 지워도 다음 실행 때 다시 만들어집니다. 스택 디렉터리의 `terraform.tfvars` 도 함께 복사되어 적용됩니다.

---

## 4. apply / destroy

스택 사이 의존 관계(`dependency`)를 따라 순서가 정해지므로 **`live/prod` 에서 명령 한 번으로 전체를 apply / destroy** 합니다.

```bash
cd infra/terraform/live/prod

terragrunt run --all plan        # 인프라가 내려가 있어도 실행 가능 (mock_outputs)
terragrunt run --all apply       # 의존 순서대로 생성. 같은 단계 스택은 병렬
terragrunt run --all destroy     # 역순 삭제. 10-global · 11-registry 는 제외 (12-secrets 는 run --all 대상 아님)

# 스택 하나만
cd 80-main-edge
terragrunt plan
terragrunt apply
terragrunt output -raw api_url
```

- `run --all apply · destroy` 는 대상 스택 목록을 보여주고 확인을 받습니다. 확인 없이 진행하려면 `--non-interactive` 를 붙입니다.
- `run --all apply` 는 🔒 `10-global` · `11-registry` · `13-frontend` · `14-gcp-llm` 도 포함합니다. 변경이 없으면 No changes 로 끝납니다.
- `10-global` · `11-registry` · `13-frontend` · `14-gcp-llm` 은 `exclude`(destroy) 로 `run --all destroy` 에서 빠지고, `prevent_destroy` 로 스택 디렉터리에서 직접 `terragrunt destroy` 해도 막힙니다.
- `10-global` 의 GitHub OIDC 공급자(`token.actions.githubusercontent.com`)는 URL 이 고정이라 **계정에 하나뿐인 공용 리소스**입니다 (공유 계정의 다른 팀도 같은 공급자를 씀). 지우거나 audience 를 바꾸지 않습니다 (`prevent_destroy`). 다른 팀이 먼저 만들었으면 `create_github_oidc_provider = false` 로 기존 공급자를 씁니다.
- `12-secrets` 는 `exclude`(all) 로 `run --all` 의 plan · apply · destroy 모두에서 빠집니다. 값(ephemeral 변수)이 있어야 plan 이 되므로 **값을 등록할 때만 스택 디렉터리에서 직접 apply** 합니다 (5절 "외부에서 발급한 비밀값"). 대기열 확인: `terragrunt list --queue-construct-as=apply`
- **`TG_PROVIDER_CACHE=1` 을 켭니다.** 끄면 스택마다 캐시 디렉터리에 AWS provider 를 따로 받아 스택당 약 760MB 를 쓰고 첫 실행이 오래 걸립니다. 켜면 provider 를 한 번만 받아 공유합니다 (`run --all plan` 캐시가 찬 상태 약 1분).
- **provider 버전은 모든 스택이 같게 맞춥니다.** lock 파일이 스택마다 있어서 처음 init 한 시점의 버전이 따로 고정됩니다. 버전을 올릴 때는 한 스택만 올리지 않고 전체를 한 번에 올린 뒤, 🔒 스택이 No changes 인지 확인합니다.
  ```bash
  terragrunt run --all -- init -upgrade
  ```

```
bootstrap                                  🔒 최초 1회 (terraform)
10-global   11-registry   12-secrets   13-frontend   14-gcp-llm   🔒 최초 1회, 이후 변경 시에만 (12-secrets 는 직접 apply)
─────────────────────── 매일 재생성 ───────────────────────
20-network   21-observability-base
30-security
40-cicd   41-main-data   42-payment-data   43-messaging   44-payment-endpoints
50-payment-webhook
60-payment-app   61-payment-mock
70-main-cluster-kubeadm   71-payment-link
80-main-edge
90-observability-alarms
```

- 서비스 도메인은 운영 계정 Route53 에서 등록한 `meomulm.click` 이고, `10-global` 의 `domain_name` · `enable_certificate` 기본값에 들어 있습니다. 등록 시 자동 생성된 Zone 을 import 해 씁니다 ([`dns.tf`](live/prod/10-global/dns.tf) 상단 주석 [A] 절차). `domain_name = null` 로 두면 도메인 없이도 apply 할 수 있습니다.
- `bootstrap`, `10-global`, `11-registry`, `12-secrets`, `13-frontend`, `14-gcp-llm` 은 **destroy 하지 않습니다.**
  Hosted Zone 을 다시 만들면 NS 가 바뀌고, CloudFront 는 생성 · 삭제가 느리고 사이트 릴리스 · 객실 사진이 사라지고, Object Lock 로그 버킷은 잠긴 객체가 남아 있으면 삭제할 수 없고, OIDC 발급자가 바뀌면 IRSA 신뢰 정책이 깨지고, ECR 을 지우면 이미지가 사라지고, 외부 비밀값은 사람이 다시 발급 · 등록해야 하고, Workload Identity Pool · Provider 는 삭제 후 30일 동안 같은 ID 를 쓸 수 없습니다.

### 스택별 소요 시간

빈 상태에서 apply, 전체 destroy 기준 실측값입니다.

| 스택 | 조건 | apply | destroy |
|---|---|---|---|
| `13-frontend` 🔒 | 최초 1회. 버킷 2개 · CloudFront(2분 49초) · KeyValueStore(1분 24초) · Function · 레코드 4개 (2026-10-22) | 5분 07초 | (destroy 안 함) |
| `14-gcp-llm` 🔒 | 최초 1회. API 4개(STS 25초) · 서비스 계정 · Pool · Provider · IAM 3개, 사전 작업 때문에 2번 나눠 apply (2026-10-23) | 52초 + 37초 | (destroy 안 함) |
| `20-network` | `single_nat_gateway = true` (NAT 3개, 기본값), `enable_payment_network_firewall = false` (기본값) | 2분 13초 – 2분 35초 | 1분 45초 – 1분 52초 |
| `20-network` | 위 + `enable_payment_network_firewall = true` (엔드포인트 1개. NFW 생성 4분 52초 – 5분 03초, 삭제 1분 47초) | 5분 20초 – 5분 28초 | 2분 46초 |
| `20-network` | `single_nat_gateway = false` (NAT 5개, NFW 도입 전 실측. NFW 엔드포인트 2개) | 2분 27초 | 1분 23초 |
| `30-security` | `enable_control_plane = true` (SG 13개, 규칙 43개. 시간은 SG 6개 · 규칙 26개 때 실측, 결제 SG 3개 · 규칙 4개 추가 apply 는 19초) | 14초 – 20초 | 14초 – 15초 |
| `40-cicd` | GitLab Runner 1대 + Ansible 묶음 업로드 (t4g.medium 기준 실측, 2026-10-21 m7g.large 로 변경. 부트스트랩 별도: 시작부터 GitLab 등록까지 약 3분 30초 – 4분) | 54초 – 58초 | 1분 25초 |
| `41-main-data` | RDS db.t4g.micro Single-AZ, Valkey 노드 1개 (RDS 약 6분 30초 – 7분, Valkey 약 5분 40초) | 6분 40초 – 7분 16초 | 5분 46초 |
| `42-payment-data` | 결제 RDS db.t4g.micro Single-AZ, Secret | 6분 37초 – 6분 39초 | 2분 13초 |
| `43-messaging` | 결제 결과 FIFO 큐 + DLQ, 큐 정책 (큐 생성 약 30초씩, 정책 약 30초) | 1분 38초 | 2분 10초 |
| `44-payment-endpoints` | 인터페이스 엔드포인트 9종(AZ 2개, `autoscaling` 포함 — 시간은 8종 때 실측, 1종 추가 apply 55초), S3 게이트웨이 엔드포인트 정책 | 57초 – 1분 04초 | 2분 24초 |
| `60-payment-app` | 결제 서버 2대(t4g.small) · 내부 NLB · Endpoint Service (시간은 1대 때 실측). 부팅 후 첫 배포(docker 설치 · pull · Flyway · 기동)까지 약 2분, 2대 동시 교체 후 둘 다 healthy 까지 4분 34초. 갱신 배포는 서버당 약 2분 40초, 2대 순차 약 6분 (AZ 시차 180초) | 2분 57초 – 3분 04초 | 1분 30초 |
| `61-payment-mock` | pg-mock 인스턴스 1대. SSM 등록은 부팅 후 약 3분 (cloud-init 이 끝난 뒤 에이전트 기동) | 34초 – 42초 | 약 1분 |
| `71-payment-link` | Interface Endpoint(AZ 2개) · private zone · 레코드 | 1분 44초 – 2분 07초 | 약 2분 |
| `70-main-cluster-kubeadm` | CP 3대(AZ 별 ASG), 워커 2대 (부트스트랩 포함) | 3분 16초 – 4분 05초 | 1분 40초 – 2분 33초 |
| `80-main-edge` | 도메인 구매 전 (HTTP, ALB · WAF) | 2분 28초 – 2분 49초 | 26초 – 37초 |
| `80-main-edge` | 인증서 발급 후 (HTTPS 리스너, `api.<도메인>` 레코드. ALB 3분 17초, 레코드 32초. 2026-10-22) | 4분 05초 | |
| **`run --all` (10 · 11 포함, 20 · 30 · 70 · 80)** | 위 기본 조건 | **10분 06초** | **5분 01초** (10 · 11 제외) |
| **`run --all` (10 · 11 포함, 20 · 30 · 40 – 44 · 70 · 80)** | 위 기본 조건 + `enable_payment_network_firewall = true` (2026-10-21) | **20분 07초** | **12분 56초** (10 · 11 제외) |
| **`run --all` (10 포함, 20 · 30 · 41 · 43 · 70 · 80)** | 위 기본 조건, 인증서 발급 후 (2026-10-22, `--filter './80-main-edge...' --filter './41-main-data...' --filter './43-messaging...'`) | **18분 16초** | |
| **`run --all` (10 포함, 20 · 30 · 41 – 44 · 60 · 61 · 70 · 71, 40 · 80 제외)** | 위 기본 조건 + `enable_payment_network_firewall = true` (2026-10-22, 아래 `--filter`) | **19분 54초 – 21분 02초** | **11분 02초** (10 제외) |

결제 쪽(`42` → `60` → `71`)이 메인 쪽(`41` → `70`)과 병렬이라 `60` · `61` · `71` 을 넣어도 전체 시간은 거의 늘지 않습니다. 가장 긴 경로는 `42` RDS(6분 40초 – 10분)에 따라 정해지고, `70` 은 `60` · `71` 을 기다리지 않습니다. 필요한 스택만 올릴 때는 `--filter '<스택>...'`(그 스택과 의존 스택)로 고릅니다.

```bash
# 결제 서버 · PrivateLink 검증 범위 (40 Runner · 80 ALB 제외). NFW 를 켤 때는 20 만 받는 변수를 환경변수로 넘긴다 (다른 스택은 무시)
TF_VAR_enable_payment_network_firewall=true terragrunt run --all apply \
  --filter './71-payment-link...' --filter './61-payment-mock...' --filter './70-main-cluster-kubeadm...'
```

`70-main-cluster-kubeadm` 은 apply 가 끝난 뒤에도 노드 부트스트랩이 이어집니다 (6절). **apply 시작부터 노드 5대 Ready 까지 약 6분 – 7분, 배포 agent 의 Traefik · whoami 설치 완료까지 약 7분 – 8분, cert-manager · pod-identity-webhook · External Secrets 까지 포함하면 약 9분 30초 (2026-10-19 실측)** (apply 중 내부 NLB 생성이 약 2분 45초 – 3분 20초, 노드 부팅 후 부트스트랩 약 3분 – 5분). 워커 1대 종료 후 교체 워커 Ready 까지 약 2분 30초 – 3분 (종료 전 drain 포함, 6절).

`70` apply 직후 `80` 을 apply 하면 `80` apply 가 끝날 즈음 부트스트랩도 끝나, **`70` apply 시작부터 ALB Target Group 워커 전부 healthy 까지 약 7분 – 8분** 입니다. `run --all apply` 는 `80` 을 공백 없이 바로 시작하므로 **명령이 끝난 뒤 1분 – 2분 더 지나야 부트스트랩이 끝납니다** (배포 agent 전환 후 실측: 명령 9분 42초, 전체 시작부터 ALB `/whoami` 200 까지 11분 37초 — 전환 전 약 11분 30초와 같음). 워커 1대 종료 후 교체 워커가 Target Group 에서 healthy 가 되기까지 약 3분 20초 – 4분.

---

## 5. 매일 재생성 스택 작성 규칙

🔁 스택은 매일 destroy 되므로 아래 설정을 지켜야 destroy / 재생성이 실패하지 않습니다.

| 대상 | 설정 |
|---|---|
| Secrets Manager | `recovery_window_in_days = 0` |
| RDS | `skip_final_snapshot = true`, `deletion_protection = false` |
| S3 | `force_destroy = true` |

🔒 스택의 리소스에는 `prevent_destroy = true` 를 겁니다.

### 비밀값

DB 비밀번호 · 토큰 같은 비밀값은 **state 에 남기지 않습니다.**

- `ephemeral "aws_secretsmanager_random_password"` 로 만들고, write-only 속성(`password_wo`, `auth_token_wo`, `secret_string_wo`)으로 리소스와 Secret 에 같은 값을 넣습니다. `random_password` 리소스는 값이 state 에 저장되므로 쓰지 않습니다.
- write-only 값은 **생성 시와 `*_wo_version` 이 바뀔 때만** 전달됩니다. 그래서 비밀값을 쓰는 리소스와 그 Secret 은 같은 스택에 두고 같은 version 변수를 씁니다. 스택 사이로 output 할 수 없습니다.
- Secret 은 고정 이름(`team04-hotel/prod/<이름>`)으로 만듭니다. 재생성 후에도 ESO(결제 DB 는 결제 서버)가 같은 이름으로 읽습니다.
- Secret 리소스 정책으로 `GetSecretValue` 를 ESO Role(결제 DB 는 결제 서버 Role `team04-hotel-payment-app`)과 **그 스택을 apply 한 주체**만 허용합니다. 다른 IAM 사용자 · Role 로 apply 하면 정책의 관리자도 그 주체로 바뀝니다.
- 값을 바꾸려면(회전) 해당 스택의 version 변수(`41-main-data` · `42-payment-data` 는 `credentials_version`)를 올려 apply 합니다.

### 외부에서 발급한 비밀값 (`12-secrets`)

사람이 외부 서비스에서 발급하는 값(Tailscale OAuth client, GitLab Runner 토큰 등)은 🔒 `12-secrets` 에 고정 이름 Secret 으로 둡니다. 값은 **ephemeral 변수 → `secret_string_wo`** 로 넣어 state · plan 에 남지 않습니다.

| Secret | 값 | 출처 | 읽는 쪽 |
|---|---|---|---|
| `team04-hotel/prod/ci-runner-tailscale` | `{oauth_client_secret}` | Tailscale 콘솔 OAuth client (`tag:ci-runner`, `infra/ansible/.env` 의 `TS_CI_RUNNER_OAUTH_CLIENT_SECRET` 과 같은 값) | `40-cicd` Runner Role |
| `team04-hotel/prod/ci-runner-gitlab` | `{url, token}` | `gitlab.yml --tags runner_token` 이 만든 `infra/ansible/.secrets/aws-ci-runner.env` ([Ansible README](../ansible/README.md) 13절) | `40-cicd` Runner Role |
| `team04-hotel/prod/toss-payments` | `{secret_key}` | 토스페이먼츠 개발자센터 API 키 → 결제위젯 연동 키의 **시크릿 키**(테스트 `test_gsk_*`, 지금은 로컬 `backend/.env` 의 `TOSS_SECRET_KEY` 와 같은 값). 프론트 클라이언트 키(`test_gck_*`)와 같은 줄의 한 쌍 | `60-payment-app` 결제 서버 Role (`TOSS_SECRET_KEY`) |
| `team04-hotel/prod/github-app` | `{app_id, installation_id, private_key}` | gitops 레포 릴리스 PR 용 GitHub App ([`infra/gitops/prod/README.md`](../gitops/prod/README.md) "릴리스"). App ID · Installation ID 는 App 설정 화면, 개인 키는 **레포 밖**에 두고(`.env` 의 `GITHUB_APP_PRIVATE_KEY_FILE`) 등록 후 지우거나 비밀번호 관리자로 옮김 | `40-cicd` Runner Role (`release:gitops-pr` job) |
| SSM `/team04-hotel/prod/frontend/toss-client-key` (String) | 클라이언트 키 문자열 | 위 시크릿 키와 같은 줄의 **클라이언트 키**(테스트 `test_gck_*`, `.env` 의 `TOSS_CLIENT_KEY`). 브라우저에 노출되는 공개 키라 Secrets Manager 대신 Parameter Store, 레포 · git 이력에 남기지 않으려고 여기에 둠. 시크릿 키 Secret 에 함께 넣으면 Runner 가 시크릿 키까지 읽게 되므로 분리 | `40-cicd` Runner Role (`release:prepare` → `release:frontend-build` 의 `VITE_TOSS_CLIENT_KEY`) |

처음 등록 · 값 교체 (온프레미스 GitLab 재생성으로 토큰이 바뀐 경우 등):

값을 export 하지 않습니다. `terragrunt.hcl` 이 이 디렉터리의 `.env`(gitignore)를 읽어 넘깁니다. 운영 값은 이 파일에만 두고 `backend/.env` · `infra/ansible/.env` 같은 개발 설정을 읽지 않습니다 (개발 설정을 바꿔도 운영 값이 따라가지 않게). 같은 값이라도 여기에 따로 적습니다.

```bash
cd infra/terraform/live/prod/12-secrets
cp .env.example .env   # 처음 한 번. 값을 채운다 (GitHub App 개인 키만 .pem 파일 경로)

# 교체할 때는 variables.tf 의 해당 version(ci_runner_credentials_version · github_app_credentials_version · toss_credentials_version)을 올린 뒤
AWS_PROFILE=team04 terragrunt apply
```

- 값은 모두 필요합니다 (값을 바꾸지 않는 Secret 도 plan 에 값이 있어야 함). 실제로 다시 보내는 것은 version 이 바뀐 Secret 만입니다.
- `.env` 가 없거나 항목이 비면 값이 빈 문자열로 넘어가 변수 검증에서 막힙니다. 어떤 값이 비었는지는 검증 오류 메시지의 변수 이름으로 확인합니다.
- `--inputs-debug` 는 값을 `terragrunt-debug.tfvars.json` 파일로 쓰므로 쓰지 않습니다. `terragrunt render` 도 값을 화면에 출력합니다.
- 값이 바뀌면 `.env` 를 고치고 해당 version 을 올립니다. 예: 온프레미스 GitLab 재생성으로 `aws-ci-runner.env` 의 토큰이 바뀜 → `GITLAB_RUNNER_TOKEN` 수정 + `ci_runner_credentials_version` 증가.
- 값이 비었거나 형식(`tskey-client-` · `https://` · `glrt-` · `test_gsk_` 등 시크릿 키 · `test_gck_` 클라이언트 키)이 다르면 변수 검증에서 막힙니다.
- 토스 시크릿 키와 클라이언트 키는 한 쌍이라 `toss_credentials_version` 하나로 함께 다시 넣습니다. 클라이언트 키는 다음 릴리스 빌드부터 반영됩니다 (변경 이력: `aws ssm get-parameter-history`).
- Secret 리소스 정책은 `GetSecretValue` 를 읽는 Role(Runner Secret 은 `team04-hotel-ci-runner`, 토스는 `team04-hotel-payment-app`)과 apply 한 주체만 허용합니다.
- GitHub App 개인 키(`.pem`)는 GitHub 에서 다시 받을 수 없습니다. 분실하면 새 키를 만들고 `github_app_credentials_version` 을 올려 다시 등록합니다.
- 이미 떠 있는 Runner 는 부팅 때 값을 읽었으므로, 교체 후에는 Runner 를 다시 만듭니다 (`40-cicd` apply 또는 ASG 인스턴스 종료).

```bash
# 값 확인 (관리자만 가능)
AWS_PROFILE=team04 aws secretsmanager get-secret-value --secret-id team04-hotel/prod/main-db --query SecretString --output text

# state 에 비밀값이 없는지 점검. 값이 null · "" 이거나 true(sensitive_values 의 민감 표시)면 정상, 실제 문자열이 나오면 안 됨
cd live/prod/41-main-data
AWS_PROFILE=team04 terragrunt show -json | jq '[.. | objects | to_entries[] | select(.key | test("password|auth_token|secret_string")) | {(.key): .value}]'
```

---

## 6. `70-main-cluster-kubeadm` 부트스트랩 확인

CP 3대와 워커는 apply 가 끝난 뒤 user-data 가 각각 [`aws-control-plane.yml`](../ansible/aws-control-plane.yml), [`aws-worker.yml`](../ansible/aws-worker.yml) 을 실행해 클러스터를 구성합니다 ([Ansible README](../ansible/README.md) 13절). CP-a 는 마지막에 GitOps pull 배포 agent 를 설치하고, agent 가 워커 Ready 후 gitops 레포에서 Traefik · whoami 를 설치합니다 ([`infra/gitops/prod`](../gitops/prod/README.md)).
**apply 가 성공해도 부트스트랩은 그 뒤 몇 분 더 걸리고, 실패해도 apply 결과에 나타나지 않습니다.**

```bash
# 인스턴스 ID 확인 → SSM 접속 (SSM 은 키 페어 · 22 포트 없이 접속). CP · 워커 모두 ASG 라 인스턴스 ID 는 교체 때마다 바뀐다
AWS_PROFILE=team04 aws ec2 describe-instances \
  --filters Name=tag:Project,Values=team04-hotel Name=tag:Role,Values=control-plane,worker Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,InstanceId]' --output text
AWS_PROFILE=team04 aws ssm start-session --target <인스턴스 ID>

# 노드 안에서
sudo tail -f /var/log/cloud-init-output.log        # user-data · Ansible 출력. 마지막 줄 "[bootstrap] 완료" 면 성공
cloud-init status --long                           # status: done / error
sudo kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes -o wide
```

- CP-b · c · 워커 로그가 `CA cert hash 기록 대기` 에서 멈춰 있으면 CP-a 의 로그를 먼저 봅니다.
- CP-a 로그가 `워커 Ready 대기` 에서 멈춰 있으면 워커 로그를 봅니다.
- Ansible 묶음을 고친 뒤 apply 하면 S3 객체만 바뀌고, 이미 떠 있는 노드에는 반영되지 않습니다 (user-data 는 첫 부팅에만 실행). 다시 확인하려면 스택을 destroy → apply 하거나, 해당 인스턴스를 종료해 ASG 가 새로 띄우게 합니다 (시작 템플릿은 최신 버전을 씀). CP 는 한 번에 1대씩만 종료합니다 (아래 CP 교체).
- 워커 join 은 CP-b · c 가 etcd 멤버로 추가되는 동안 타임아웃 날 수 있어 reset 후 30초 간격으로 3회까지 다시 시도합니다 (`kubeadm_join_retries`). 그래도 실패하면 아래 수명주기에 따라 ASG 가 교체합니다.

### 워커 수명주기 (교체 · 스케일 인 · 부트스트랩 실패)

| 상황 | 처리 | 담당 |
|---|---|---|
| 워커 종료 (스케일 인 · 교체 · 수동 종료) | 종료 lifecycle hook 으로 `Terminating:Wait` → cordon · drain → lifecycle action 완료 → 종료 | NTH 큐 모드 (CP-a 가 설치, CP 에 hostNetwork) |
| 종료된 워커의 Node 객체 | 인스턴스가 사라지면 Node 삭제 → Calico IP 블록 회수 | aws-cloud-controller-manager (CCM) · calico-kube-controllers |
| 부트스트랩 실패 (`kubeadm_join_retries` 소진 등) | user-data 가 ASG 에 `Unhealthy` 보고 → 교체. aws CLI 설치 전 실패면 인스턴스를 꺼 EC2 헬스체크가 교체 | user-data `trap ERR` |
| join 은 했지만 트래픽을 못 받음 | `80-main-edge` Target Group(Traefik `/ping`) unhealthy → 교체 | ASG `health_check_type = "ELB"`, 기동 후 600초는 판단 안 함 |

- 노드는 kubelet `cloud-provider: external` 로 등록되어 CCM 이 초기화하기 전까지 `node.cloudprovider.kubernetes.io/uninitialized` taint 가 붙습니다. CCM 이 `spec.providerID`(`aws:///<AZ>/<인스턴스 ID>`) 를 넣고 taint 를 지웁니다.
- NTH 는 `aws-node-termination-handler/managed` 태그가 있는 인스턴스(워커) 만 drain 합니다. drain 최대 120초, hook timeout 300초 (응답이 없으면 그대로 종료).
- lifecycle hook 은 ASG 와 별도 리소스라 destroy 때 먼저 지워집니다. 스택 destroy 는 hook 을 기다리지 않습니다.

```bash
# 노드 안에서 (CP)
K="sudo kubectl --kubeconfig /etc/kubernetes/admin.conf"
$K get nodes -o custom-columns=NAME:.metadata.name,PROVIDER_ID:.spec.providerID,TAINTS:.spec.taints[*].key
$K -n kube-system logs ds/aws-cloud-controller-manager | grep -i delet       # Node 삭제
$K -n kube-system logs deploy/aws-node-termination-handler                   # drain · lifecycle action 완료
$K get events -A --field-selector source=aws-node-termination-handler       # cordon · drain 이벤트
```

- **부트스트랩을 디버깅할 때:** 실패한 워커는 바로 교체되어 로그를 볼 시간이 없습니다. 먼저 ASG 교체를 멈추고, 끝나면 다시 켭니다.
  ```bash
  AWS_PROFILE=team04 aws autoscaling suspend-processes --auto-scaling-group-name team04-hotel-main-worker --scaling-processes ReplaceUnhealthy
  AWS_PROFILE=team04 aws autoscaling resume-processes  --auto-scaling-group-name team04-hotel-main-worker --scaling-processes ReplaceUnhealthy
  ```
  부트스트랩 코드에 버그가 있으면 워커가 교체를 계속 반복하고, Traefik 이 클러스터 전체에서 죽으면 모든 워커가 ELB 헬스체크로 교체될 수 있습니다.
- **instance refresh 없음 (상시 운영 시 필요):** 시작 템플릿이 바뀌어도 기존 워커는 그대로입니다. 매일 재생성하므로 지금은 다음 apply 때 반영됩니다. 24시간 운영이라면 AMI 패치 · Kubernetes 업그레이드 · 노드 설정 변경을 기존 워커에 반영하기 위해 instance refresh 가 필요하고, 그때는 AMI 고정(지금은 SSM `current` 를 따라가 관계없는 apply 에서도 템플릿이 바뀜), `min_healthy_percentage = 100` (새 워커를 먼저 띄움), warmup, 앱 PodDisruptionBudget, CP 먼저 업그레이드하는 순서를 함께 정합니다. 당일 반영이 필요하면 `aws autoscaling start-instance-refresh` 를 수동으로 실행하거나 워커를 한 대씩 종료합니다 (둘 다 NTH 가 drain).

### CP 교체 (1대)

CP 는 AZ 별 ASG(1대 고정) 입니다. CP 가 종료 · 장애로 사라지면 아래 과정이 자동으로 진행됩니다. etcd 3대 중 2대가 남아 있어 그동안 클러스터는 계속 동작합니다.

| 단계 | 처리 | 담당 |
|---|---|---|
| 감지 · 교체 | EC2 상태 이상 → 종료 → 같은 AZ 에 새 CP 기동. 부트스트랩(join) 실패는 user-data 가 `Unhealthy` 보고 | ASG (`health_check_type = "EC2"`) |
| apiserver 트래픽 | `/readyz` 실패 CP 를 트래픽에서 뺌 (5초 간격 × 2회), 새 CP 는 ASG 연결로 자동 등록 | 내부 NLB |
| 사라진 CP 의 etcd 멤버 | 멤버 이름(private DNS) 의 pending · running 인스턴스가 없으면 `member remove` | 남은 CP 의 `team04-cp-reconcile.timer` (1분) |
| `kubeadm-certs` Secret | init 2시간 후 삭제되면 같은 certificate-key 로 다시 올림 → 교체된 CP 가 언제든 join 가능 | 같은 timer |
| 사라진 CP 의 Node 객체 | 인스턴스가 사라지면 Node 삭제 | CCM |
| 새 CP join | `ca-cert-hash` 가 있으므로 CP-a 도 init 이 아니라 join | user-data → `aws-control-plane.yml` |

- CP ASG 는 apiserver 헬스체크(ELB)를 쓰지 않습니다. etcd 가 잠시 불안정해 3대의 `/readyz` 가 동시에 실패하면 3대가 함께 교체되어 etcd 데이터가 모두 사라지기 때문입니다.
- CP 가 사라진 직후 NLB 가 unhealthy 로 판정하기 전까지(수십 초 이내) 그 CP 로 간 연결은 실패합니다. kubelet · 컨트롤러 · kubectl 은 다시 연결하므로 요청이 잠깐 늦어지는 정도입니다.
- 처리는 "꺼진 뒤" 에만 필요해서(CP 에는 drain 할 앱 파드가 없음) 워커처럼 lifecycle hook · 이벤트를 쓰지 않고 주기 점검(reconcile) 으로 합니다. 이벤트를 놓쳐도 다음 주기에 처리됩니다.

```bash
# CP 안에서
sudo journalctl -u team04-cp-reconcile --since "1 hour ago"     # 고친 것이 있을 때만 로그 (멤버 제거, Secret 재업로드)
sudo crictl exec "$(sudo crictl ps --name '^etcd$' -q)" \
  etcdctl --endpoints https://127.0.0.1:2379 --cacert /etc/kubernetes/pki/etcd/ca.crt \
  --cert /etc/kubernetes/pki/etcd/healthcheck-client.crt --key /etc/kubernetes/pki/etcd/healthcheck-client.key \
  member list -w table                                              # 멤버 3개, 전부 started
```

- **범위 밖 (EC2 직접 운영의 제약):** CP 2대 이상 동시 장애(etcd 쿼럼 상실) 복구와 etcd 백업 · 복원은 구현하지 않았습니다. 쿼럼을 잃으면 남은 CP 의 `member remove` 도 실패하므로 스택을 destroy → apply 로 다시 만듭니다 (클러스터 상태는 초기화).
- CP 를 일부러 교체할 때는 **1대씩**, 새 CP 가 `Ready` 이고 etcd 멤버가 3개 `started` 인 것을 확인한 뒤 다음 CP 를 종료합니다.

---

## 7. `80-main-edge` 동작 확인

`인터넷 → ALB → 워커 NodePort 30080 → Traefik → 파드` 경로입니다. 워커 ASG 를 Target Group 에 연결하므로 ASG 가 새로 띄운 워커도 자동 등록됩니다.
Target Group 헬스체크는 Traefik `/ping` 입니다. **Traefik 은 CP-a 부트스트랩 마지막에 배포 agent 가 설치하므로 `70` apply 직후 `80` 을 apply 하면 부트스트랩이 끝날 때까지 타깃이 unhealthy 로 보입니다.**

도메인 · 인증서 유무(`10-global` output)에 따라 리스너가 달라집니다.

| `10-global` 상태 | 리스너 | 접속 주소 (`terragrunt output api_url`) |
|---|---|---|
| 도메인 구매 전 | 80 → 워커 | `http://<ALB DNS>` |
| Zone 만 있음 | 80 → 워커, `api.<도메인>` 레코드 | `http://api.<도메인>` |
| 인증서 발급 후 | 80 → 443 리다이렉트, 443 → 워커 | `https://api.<도메인>` |

```bash
cd live/prod/80-main-edge
curl -i "$(AWS_PROFILE=team04 terragrunt output -raw api_url)/whoami"   # 200, X-Forwarded-For 첫 값이 내 공인 IP

# Target Group 상태 (워커 전부 healthy)
AWS_PROFILE=team04 aws elbv2 describe-target-health \
  --target-group-arn "$(AWS_PROFILE=team04 aws elbv2 describe-target-groups --names team04-hotel-main-worker --query 'TargetGroups[0].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text
```

- WAF 차단 응답은 403 입니다. IP 당 rate limit 은 기본 60초에 300회(`waf_rate_limit`, `waf_rate_limit_window_sec`)이고, 넘은 뒤 차단까지 수십 초 걸립니다.
- 본문 8KB 초과 요청은 경로와 관계없이 403 입니다 (관리형 규칙 `SizeRestrictions_BODY`). 객실 이미지는 Presigned PUT 으로 S3 에 직접 올리므로 API 본문이 크지 않습니다. 큰 파일은 API 대신 Presigned URL 로 받습니다.
- 액세스 로그는 `10-global` 로그 버킷 `alb/` 에 5분 단위로 쌓입니다. Object Lock 버킷이라 잠금 기간(7일) 동안 지워지지 않습니다.
- unhealthy 타깃이 있으면 그 워커가 클러스터에 join 했는지(`kubectl get nodes`) 먼저 봅니다 (6절). join 하지 못한 워커는 kube-proxy 가 없어 NodePort 가 응답하지 않습니다.

---

## 8. 결제 VPC egress 검사 (`20-network` Network Firewall)

결제 앱 · lb 서브넷의 외부행 트래픽은 결제 VPC 안의 AWS Network Firewall(분산형)을 거쳐 NAT 로 나갑니다. 복귀 트래픽도 같은 엔드포인트를 거칩니다 (비대칭이면 NFW 가 흐름을 버립니다).

```
app · lb  ─ private-<az> RT 0.0.0.0/0 ─▶ NFW 엔드포인트(firewall 서브넷 /28) ─ firewall-<az> RT ─▶ NAT ─▶ IGW
NAT 응답  ─ public RT <app · lb 서브넷 CIDR> ─▶ 같은 NFW 엔드포인트 ─▶ app · lb
```

- VPC 엔드포인트(ECR · SSM · SQS · Secrets Manager · Logs), S3 게이트웨이(prefix list), 결제 DB 는 더 구체적인 경로라 NFW 를 거치지 않습니다.
- **`enable_payment_network_firewall` 기본값은 `false`(개발 기간 비용 절감) 입니다.** 끄면 app · lb 가 NAT 로 바로 나가고 DNS Firewall · SG 만 남습니다 (IP 직접 접속은 막지 못함). firewall 서브넷 · 라우트 테이블은 무료라 남겨 둡니다. rc.3 전에 기본값을 `true` 로 바꿉니다.
  ```bash
  # 그날만 켜서 검증 (다음 재생성 때 기본값으로 꺼짐). 켜기 약 5분
  AWS_PROFILE=team04 terragrunt apply -var enable_payment_network_firewall=true
  ```
- **켜진 상태에서 `false` 로 바로 apply 하면 실패합니다** (`DeleteFirewall ... VPC endpoint(s) still exist in route table(s)`). Terraform 이 private 라우트를 NAT 로 바꾸기 전에 NFW 삭제를 먼저 시도하기 때문입니다 (의존 리소스 수정과 의존 대상 삭제 사이의 순서를 보장하지 않음). 매일 destroy 로 내려가는 경우는 라우트가 먼저 삭제되므로 문제없습니다. 그날 바로 꺼야 하면 라우트를 먼저 NAT 로 돌리고 apply 합니다.
  ```bash
  # single_nat_gateway = false 면 AZ 마다 team04-hotel-payment-<az> NAT 로 바꾼다
  NAT=$(AWS_PROFILE=team04 aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=team04-hotel-payment-a Name=state,Values=available --query 'NatGateways[0].NatGatewayId' --output text)
  for az in a b; do
    RT=$(AWS_PROFILE=team04 aws ec2 describe-route-tables --filters Name=tag:Name,Values=team04-hotel-payment-private-$az --query 'RouteTables[0].RouteTableId' --output text)
    AWS_PROFILE=team04 aws ec2 replace-route --route-table-id "$RT" --destination-cidr-block 0.0.0.0/0 --nat-gateway-id "$NAT"
  done
  AWS_PROFILE=team04 terragrunt apply     # NFW 삭제 약 3분 30초 (firewall 2분 18초 + 정책 · rule group)
  ```
- 엔드포인트 수는 NAT 와 맞춥니다. `single_nat_gateway = true` 면 a 하나, `false` 면 a · b.
- Main · Deployment VPC 는 검사하지 않습니다 (`modules/vpc` 의 `firewall_endpoint_ids` 기본값 `{}`).

| 계층 | 막는 것 |
|---|---|
| DNS Firewall (`dns-firewall.tf`) | 허용 목록(`payment_dns_allowed_domains`) 밖 도메인 이름 해석 → NXDOMAIN |
| SG (`30-security` P5) | 443 외 포트, UDP |
| Network Firewall (`network-firewall.tf`) | TLS SNI 가 `payment_egress_allowed_sni`(기본 `api.tosspayments.com`) 가 아닌 연결, SNI 없는 IP 직접 접속, 평문 HTTP |

- 규칙은 STRICT_ORDER, 기본 동작은 `aws:drop_established` + `aws:alert_established` 입니다. `drop_strict` 는 SNI 를 보기 전 TCP 핸드셰이크부터 막아 허용 도메인도 연결되지 않으므로 쓰지 않습니다.
- 허용 도메인 추가는 `payment_egress_allowed_sni` 와 `payment_dns_allowed_domains` 를 함께 고칩니다. rule group `capacity`(100) 는 바꾸면 교체되므로 그대로 둡니다.
- **한계**: SNI 는 클라이언트가 보내는 값이라, 허용 도메인 이름을 SNI 에 넣고 다른 IP 로 접속하면(`curl --resolve api.tosspayments.com:443:<임의 IP>`) 통과합니다. 결제 서버 침해를 가정한 완전한 차단은 TLS inspection 이 필요합니다.
- 로그: alert → CloudWatch Logs `/aws/vendedlogs/team04-hotel/payment-network-firewall/alert` (90일), flow → `10-global` 로그 버킷 `network-firewall/` (몇 분 단위로 적재).
- 비용: 엔드포인트 1개 시간당 $0.395 (월 약 $290) + 처리량 GB 당 $0.065. NFW 요금은 그대로 내고, 같은 경로의 NAT Gateway 시간 요금 · 처리 요금이 NFW 엔드포인트 시간 · 처리량만큼 1:1 로 면제됩니다. 결제 VPC 는 NAT 트래픽이 모두 NFW 를 거치므로 NAT 요금이 0 이 되어, 늘어나는 비용은 월 약 $257 + GB 당 $0.02 입니다.

```bash
# 차단 alert 확인 (최근 15분)
AWS_PROFILE=team04 aws logs filter-log-events \
  --log-group-name /aws/vendedlogs/team04-hotel/payment-network-firewall/alert \
  --start-time $(( ($(date +%s) - 900) * 1000 )) --query 'events[].message' --output text
```

결제 앱 서브넷에서 검증한 결과 (2026-10-21, `payment_app` SG 테스트 인스턴스):

| 요청 | 결과 |
|---|---|
| `curl https://api.tosspayments.com/v1/payments` | 401 (도달) |
| `curl --resolve one.one.one.one:443:1.1.1.1 https://one.one.one.one/` | timeout, alert `aws:alert_established` (SNI `one.one.one.one`) |
| `curl -k https://1.1.1.1/` (SNI 없음) | timeout, alert |
| `curl https://example.com/` | DNS Firewall NXDOMAIN |
| `curl https://sqs.us-east-1.amazonaws.com/`, `dnf makecache` | 정상 (엔드포인트 · S3 게이트웨이, NFW 미경유) |

---

## 9. 결제 서버 · PrivateLink (`60-payment-app` · `61-payment-mock` · `71-payment-link`)

메인 → 결제는 PrivateLink 하나로만 연결하고, 결제 → 메인은 SQS(`43-messaging`) 로만 보냅니다. 두 VPC 사이에는 Peering · TGW 가 없습니다.

```
메인 파드 ─ payment.team04-hotel.internal:3004 ─▶ 71 Interface Endpoint (worker 서브넷 a · b, SG main_privatelink ← main_worker 3004)
  ─▶ 60 Endpoint Service ─▶ 결제 NLB (lb 서브넷, TCP 3004, cross-zone) ─▶ 결제 서버 ASG (app 서브넷) 3004
                                    └ 헬스체크 HTTP 3104 GET /health
결제 서버 ─ 3007 ─▶ 61 pg-mock (app-a 고정 IP, PAYMENT_PROVIDER=MOCK 일 때)
```

- **고정 이름**: 엔드포인트 DNS 이름은 재생성마다 바뀌므로, 메인 VPC 에만 연결한 private zone `team04-hotel.internal` 의 `payment` 레코드(alias)로 부릅니다. gitops backend values `PAYMENT_SERVICE_HOST` 는 `payment.team04-hotel.internal:3004` 로 고정입니다 (`terragrunt output payment_service_host`).
- **NLB SG**: PrivateLink 트래픽에는 SG 인바운드 규칙을 적용하지 않고(`enforce_security_group_inbound_rules_on_private_link_traffic = off`), `payment_nlb` 에 인바운드 규칙을 두지 않습니다. 결제 VPC 안에서는 NLB 에 붙을 수 없고 PrivateLink 만 통과합니다.
- **Endpoint Service 허용 주체**: 공유 계정이라 계정 전체가 아니라 `60` 을 apply 한 주체만 허용하고 자동 수락합니다. `71` 도 같은 주체로 apply 합니다.
- **결제 서버**: Amazon Linux 2023(arm64) `t4g.small`, 기본 2대(AZ a · b, `desired_capacity = 2`, `min_size = 1`). IMDSv2 hop limit 1 이라 컨테이너는 host 네트워크로 띄워 인스턴스 Role 을 씁니다. Role 이름 `team04-hotel-payment-app` 은 42 · 12 Secret 정책과 43 큐 정책이 참조하므로 바꾸지 않습니다.
- **배포**: 결제 서버 안의 pull agent 가 합니다 (아래 [결제 서버 배포](#결제-서버-배포-pull-agent)). docker compose 는 AL2023 저장소에 없고 결제 VPC 는 GitHub 로 나갈 수 없어 쓰지 않습니다.
- **pg-mock**: 결제 서버와 분리한 인스턴스 1대입니다 (ASG 없음). 주소는 `20-network` 가 자동 할당에서 뺀 대역(`10.20.8.16/28`, subnet CIDR reservation) 안의 고정 IP 라 다른 ENI 와 겹치지 않습니다 (`terragrunt output pg_mock_url`). 결제 서버와 같은 release 태그로 스스로 갱신합니다. 필요 없으면 `enable_pg_mock = false`.
- **`70` 과의 관계**: `71` 은 `70` 과 같은 단계라 서로 참조하지 않습니다. `run --all apply` 에서 `70` 은 `60` · `71` 을 기다리지 않습니다.
- **알려진 제약**: 메인 → 결제 gRPC 는 평문입니다 (PrivateLink 는 AWS 내부망 · 단방향 · SG 제한). 도메인 구매 후 TLS 를 적용할 때 공인 인증서를 받을 수 있도록 고정 이름을 `payment.<도메인>` 으로 옮기고 gitops values 를 1회 고칩니다.

```bash
# 결제 서버 · pg-mock 인스턴스 → SSM 접속
AWS_PROFILE=team04 aws ec2 describe-instances \
  --filters Name=tag:Project,Values=team04-hotel Name=tag:Role,Values=payment-app,payment-mock Name=instance-state-name,Values=running \
  --query 'Reservations[].Instances[].[Tags[?Key==`Name`]|[0].Value,InstanceId,PrivateIpAddress]' --output text
AWS_PROFILE=team04 aws ssm start-session --target <인스턴스 ID>
sudo tail -n 20 /var/log/cloud-init-output.log      # 첫 배포 결과와 마지막 줄 "[bootstrap] 완료"

# NLB Target Group 상태 (healthy)
AWS_PROFILE=team04 aws elbv2 describe-target-health \
  --target-group-arn "$(AWS_PROFILE=team04 aws elbv2 describe-target-groups --names team04-hotel-payment-app --query 'TargetGroups[0].TargetGroupArn' --output text)" \
  --query 'TargetHealthDescriptions[].[Target.Id,TargetHealth.State]' --output text

# 메인 클러스터 테스트 파드 → PrivateLink (gRPC 포트 TCP 연결)
kubectl run pl-test --restart=Never --image=busybox:1.36 -- \
  sh -c 'nslookup payment.team04-hotel.internal && nc -z -w 5 payment.team04-hotel.internal 3004 && echo connected'
kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/pl-test --timeout=60s; kubectl logs pl-test; kubectl delete pod pl-test
```

검증 결과 (2026-10-22, `enable_payment_network_firewall = true`, apply → destroy → apply 후 plan No changes):

| 확인 | 결과 |
|---|---|
| 메인 테스트 파드 → `payment.team04-hotel.internal:3004` | 엔드포인트 ENI 2개(worker a · b)로 해석, 결제 서버 응답. 재생성 후 ENI IP 가 바뀌어도 같은 이름으로 연결 |
| 결제 서버 → 메인 워커 10250 | 차단 (경로 없음) |
| pg-mock → 결제 NLB IP 3004 · 결제 서버 3004 직접 | 차단 (`payment_nlb` 인바운드 규칙 없음, `payment_app` 은 NLB SG 만 허용) |
| 결제 서버 · pg-mock 부팅 | NFW 를 켠 상태에서 docker 설치(S3 게이트웨이) · SSM 등록 정상 |
| 결제 서버 2대 중 1대 종료 (`terminate-instance-in-auto-scaling-group`) | 1초 간격 150회 요청 실패 0. ASG 가 NLB 에서 먼저 빼고(deregistration 30초) 종료, 교체 인스턴스 healthy |

### 결제 서버 배포 (pull agent)

결제 서버는 GitHub · Runner 가 명령을 보낼 수 없습니다. 서버가 Parameter Store 를 읽어 스스로 바꿉니다.

```
gitops envs/prod/payment/values.yaml merge (사람 승인)
  └▶ GitHub Actions sync-payment-tag (OIDC, 10-global gitops_ssm_sync Role)
       └▶ Parameter Store /team04-hotel/prod/payment/release  {"env": {...}, "image_tag": "<sha>"}   (11-registry, 쓰기는 이 Role 하나)
            └▶ 결제 서버 payment-deploy.timer (1분) · pg-mock pg-mock-deploy.timer (1분, image_tag 만)
```

결제 서버 agent(`60-payment-app/templates/payment-deploy.sh`) 순서:

1. release 가 현재 적용값과 같거나, 이미 실패한 값이면 아무것도 하지 않습니다.
2. 검증: `image_tag` 는 커밋 SHA, `env` 는 한 줄 문자열 값만. 인프라가 넣는 키(`PAYMENT_DB_*` · `TOSS_SECRET_KEY` · `SQS_*` · `PAYMENT_RESULT_QUEUE_URL` · `PG_MOCK_SERVICE_URL` · `AWS_*` · `HEALTH_PORT`)는 거부합니다 (gitops validate 도 같은 규칙).
3. 순서 맞추기: 첫 AZ(a)가 먼저, 다음 AZ 는 release 를 처음 본 뒤 `deploy_stagger_seconds`(180초) 뒤에 합니다. 다른 서버가 InService 가 아니면(배포 · 부팅 중) 다음 주기로 미룹니다.
4. ECR pull (`payment-service` · `payment-migrations`, 같은 태그) → 결제 DB · 토스 Secret 을 읽어 `/run`(tmpfs)의 0600 env 파일로
5. Flyway migrate (`useSsl=true&serverSslCert=<RDS CA>` — 이미지의 드라이버가 Connector/J 2.x 라 3.x 옵션 `sslMode` 는 무시되고 평문 접속됨. 호스트 이름 검증은 기본 켜짐). 이전 버전이 아직 서비스 중이므로 마이그레이션은 추가만 합니다
6. 자기 자신을 ASG Standby 로 → NLB 에서 빠지고 30초 drain (`connection_termination` 으로 남은 gRPC 연결을 끊어 다른 서버로 재연결)
7. payment-service 교체 → `/health` · gRPC 포트가 연속 3번 응답하면 성공 → Standby 해제
8. 실패하면 이전 release 로 되돌리고 Standby 를 해제합니다. 실패한 release 는 Parameter Store 값이 바뀔 때까지 다시 시도하지 않습니다

| 상황 | 동작 |
|---|---|
| 부팅 (최초 · ASG 교체 · 매일 재생성) | user-data 가 같은 agent 를 `--boot` 로 실행 (시차 · Standby 없음) → Parameter Store 의 현재 release 로 기동 |
| 존재하지 않는 태그 | pull 단계에서 실패 기록. 실행 중인 버전은 그대로 |
| Flyway 실패 | 실패 기록. payment-service 는 바꾸지 않음 |
| 헬스 확인 실패 | 이전 release 로 롤백. 부팅 때라 이전 release 가 없으면 NLB 헬스체크 실패로 ASG 가 교체 → gitops 를 revert 해야 멈춤 |
| ECR · Secrets Manager 일시 오류 | 실패로 기록하지 않고 다음 주기에 다시 시도 |
| 1대만 운영 (`desired_capacity = min_size`) | Standby 로 뺄 수 없어 그대로 교체 (교체 동안 결제 실패) |

설정 원본: 비밀 아닌 설정은 gitops `env`, 접속 정보 · 포트 · 큐 · pg-mock 주소는 Terraform(`/etc/payment-deploy/config.env`), 비밀값은 Secrets Manager 입니다. `PAYMENT_PROVIDER=TOSS` 일 때만 토스 시크릿 키를 읽습니다.

**RDS CA 번들**: 원본은 모노레포 `infra/gitops/prod/backend-secrets/chart/files/us-east-1-bundle.pem` 하나이고, 전달 경로만 다릅니다.

| | 전달 | 반영 시점 |
|---|---|---|
| 메인 파드 | 릴리스 PR 이 gitops `envs/prod/backend-secrets` 로 복사 → 배포 agent → ConfigMap 마운트 | gitops merge 후 1분 |
| 결제 서버 | `60` apply 때 Terraform 이 파일을 읽어 user-data 에 넣음 (결제 VPC 는 GitHub 로 나갈 수 없음) → `/etc/payment-deploy/rds-ca-bundle.pem` | 새로 뜨는 인스턴스부터 (매일 재생성 · instance refresh) |

- `60` 은 develop 또는 main 을 checkout 한 상태에서 apply 합니다. 작업 트리의 파일이 그대로 결제 서버에 들어갑니다.
- CA 교체 순서: 모노레포 파일 갱신 → 릴리스(메인 반영) → `60` apply → `aws autoscaling start-instance-refresh --auto-scaling-group-name team04-hotel-payment-app`. 번들에는 이전 · 새 CA 가 함께 들어 있어 반영 시점이 달라도 접속은 끊기지 않습니다.

```bash
# 결제 서버 안에서 (SSM 접속 후)
systemctl list-timers payment-deploy.timer
sudo journalctl -u payment-deploy --since -30min --no-pager      # agent 실행 로그
sudo cat /var/lib/payment-deploy/current.json                   # 적용된 release (previous.json = 롤백 대상, failed = 실패한 release 해시)
sudo docker ps --format '{{.Names}} {{.Image}} {{.Status}}'

# 배포 이벤트 (deploy_start · deploy_success · deploy_failed · rollback_*) — 로컬에서
AWS_PROFILE=team04 aws logs tail /team04-hotel/prod/payment/deploy --since 1h
AWS_PROFILE=team04 aws logs tail /team04-hotel/prod/payment/app --since 10m      # payment-service 출력

# 현재 release
AWS_PROFILE=team04 aws ssm get-parameter --name /team04-hotel/prod/payment/release --query Parameter.Value --output text
```

- **모드 전환 (TOSS ↔ MOCK)**: gitops `envs/prod/payment/values.yaml` 의 `env.PAYMENT_PROVIDER` 를 바꾸는 PR. 태그가 같아도 release 가 바뀌므로 위 순서로 재배포됩니다. MOCK 은 `61-payment-mock` 이 떠 있어야 합니다.
- **롤백**: 자동 롤백은 그 서버의 이전 release 로만 합니다. 버전을 되돌리려면 gitops 해당 PR 을 revert 하는 PR 을 merge 합니다 (사람 승인 경로 그대로).
- **실패한 release 를 같은 값으로 다시 시도**: 서버 안에서 `sudo rm /var/lib/payment-deploy/failed` (원인을 고친 뒤, 예: Secret 값 등록).
- **agent · 설정 변경**: user-data 는 첫 부팅에만 실행됩니다. 시작 템플릿만 바뀌고 떠 있는 서버는 그대로이므로 `aws autoscaling start-instance-refresh` 또는 매일 재생성 때 반영됩니다.

검증 결과 (2026-10-22, 결제 서버 2대, 메인 클러스터 파드에서 `payment.team04-hotel.internal:3004` 로 `GetHello` 를 0.5초 간격 호출하며 측정):

| 확인 | 결과 |
|---|---|
| 부팅 배포 (2대 동시 교체) | 두 서버 모두 `deploy_success`, 결제 DB 스키마 V1 – V3 적용, 앱 DB 세션 TLS(`TLS_AES_256_GCM_SHA384`) |
| Flyway TLS | `useSsl=true&serverSslCert` 로 접속, IP 로 접속하면 호스트 이름 검증 실패로 거부 (중간자 차단) |
| 갱신 MOCK → TOSS (같은 태그) | a → 180초 뒤 b 순서, Standby 구간 겹침 없음. 호출 916회 실패 0. TOSS 일 때만 컨테이너에 `TOSS_SECRET_KEY` |
| 헬스 실패 이미지 (테스트 이미지, 시험 후 삭제) | 서버마다 헬스 확인 실패 → 이전 release 로 롤백 (12초). b 는 a 가 InService 로 돌아온 뒤 시작. 호출 1,176회 실패 0 |
| 존재하지 않는 태그 | pull 단계에서 실패 기록, 실행 중인 버전 유지. 호출 517회 실패 0 |
| 실패한 release 재시도 | 같은 값이면 다시 시도하지 않음 (이후 이벤트 0) |
| 서버 1대 종료 → ASG 교체 | 교체 서버가 같은 release 로 부팅 배포 (종료 후 2분 06초에 성공). 호출 403회 실패 0 |
| gitops PR merge → 자동 교체 (MOCK → TOSS) | sync-payment-tag 가 OIDC 로 release 갱신 → 50초 뒤 a 시작, b 까지 5분 39초에 완료. 사람 개입 없음. 호출 830회 실패 0 |
| 로그 · 이벤트 | 비밀값 없음, 이벤트의 이미지 이름에 레지스트리(계정 ID) 없음 |

---

## 10. 프론트 · 객실 사진 (`13-frontend`)

```
https://<도메인>/*             → CloudFront Function → 사이트 버킷 releases/<KeyValueStore version>/...   (확장자 없는 경로는 index.html)
https://<도메인>/room-types/*  → 객실 사진 버킷 room-types/...                                           (1년 캐시)
https://www.<도메인>/*         → 301 루트 (api-gateway CORS 출처가 루트 하나)
```

- 🔒 상시 유지라 매일 재생성과 무관하게 프론트 · 사진이 남습니다. Zone · 인증서는 같은 1x 단계인 `10-global` 을 dependency 대신 도메인 이름으로 조회합니다.
- `40-cicd`(Runner 업로드 권한) · `70-main-cluster-kubeadm`(hotel-service IRSA) 이 `13` 의 output 을 mock 없이 읽으므로 **`13` 을 먼저 apply** 합니다 (`run --all apply` 는 순서대로 처리).
- 버킷은 CloudFront(OAC, `aws:SourceArn` = 이 배포)만 읽습니다. 쓰기는 버킷 정책이 Runner(사이트 `releases/*`) · hotel-service(사진) · apply 주체 외에는 거부합니다.
- 릴리스 · 롤백 절차는 [`infra/gitops/prod/README.md`](../gitops/prod/README.md) "릴리스" — 버전 전환은 gitops merge 후 GitHub Actions 만 합니다 (`release.tf`).

처음 apply 한 뒤 한 번만:

```bash
# gitops 레포 Secret FRONTEND_KVS_ARN (계정 ID 가 들어 있어 변수가 아니라 Secret)
AWS_PROFILE=team04 aws cloudfront describe-key-value-store \
  --name "$(terragrunt output -raw kvs_name)" --query KeyValueStore.ARN --output text
```

첫 릴리스 전(`version` = `none`)에는 사이트가 503 을 응답합니다. 확인:

```bash
curl -sI https://meomulm.click/ | head -1                                   # 첫 릴리스 전 503, 이후 200
curl -sI https://meomulm.click/hotels/1 | grep -i -E '^(HTTP|cache-control)'  # SPA 경로도 200 (index.html, no-cache)
curl -sI https://www.meomulm.click/a?b=1 | grep -i location                 # https://meomulm.click/a?b=1
curl -sI https://team04-hotel-frontend.s3.us-east-1.amazonaws.com/releases/ | head -1   # 직접 접근 403
AWS_PROFILE=team04 aws cloudfront-keyvaluestore get-key --key version \
  --kvs-arn "<위 ARN>" --query Value --output text                          # 현재 버전
```

---

## 11. 챗봇 Vertex AI 인증 (`14-gcp-llm`)

```
llm-service 파드 projected 토큰 (iss = 메인 클러스터 OIDC 발급자, aud = Provider)
  → sts.googleapis.com 토큰 교환   Provider 가 발급자의 keys.json 으로 서명 검증, backend 네임스페이스만 허용
  → llm-service-prod impersonate   backend:llm-service · backend:llm-ingest 만 workloadIdentityUser
  → Vertex AI
```

- 서비스 계정 키를 만들지 않습니다. 파드는 output `credential_config`(external_account JSON, 공개 값)와 projected 토큰만으로 인증합니다 (llm-service 는 `GCP_SA_KEY_JSON` 이 없으면 ADC 사용).
- 발급자는 IRSA 와 같은 `10-global` OIDC 버킷입니다. 같은 1x 단계라 dependency 대신 버킷 이름(`oidc_bucket_name`)으로 주소를 만듭니다.
- 🔒 상시 유지: Pool · Provider 는 삭제 후 30일 동안 같은 ID 를 쓸 수 없습니다.
- 온프레미스 dev 는 [`infra/gcp-terraform`](../gcp-terraform/README.md) (SA 키 방식) 그대로입니다.

### 사전 작업 (프로젝트 관리자 계정, 최초 1회)

terraform 서비스 계정은 IAM 을 스스로 넓힐 수 없어 관리자가 직접 부여합니다.

```bash
P=likelion-devops-7th-3rd-team4
TF=terraform@$P.iam.gserviceaccount.com

# 1. Pool · Provider 관리
gcloud projects add-iam-policy-binding $P --member=serviceAccount:$TF \
  --role=roles/iam.workloadIdentityPoolAdmin --condition=None

# 2. 운영 서비스 계정만 먼저 만든다 (이 유닛 디렉터리에서, terraform SA 로 실행)
terragrunt apply -target=google_service_account.llm_service

# 3. 그 서비스 계정 한정으로 IAM 정책 관리 권한 (workloadIdentityUser 바인딩용)
gcloud iam service-accounts add-iam-policy-binding llm-service-prod@$P.iam.gserviceaccount.com \
  --project=$P --member=serviceAccount:$TF --role=roles/iam.serviceAccountAdmin

# 4. 나머지
terragrunt apply
```

이후에는 `run --all apply` 에 포함되어 변경이 없으면 No changes 로 끝납니다.

### 확인

```bash
terragrunt output -raw credential_config | jq .
gcloud iam service-accounts keys list --managed-by=user \
  --iam-account=llm-service-prod@likelion-devops-7th-3rd-team4.iam.gserviceaccount.com   # 키 0개
```
