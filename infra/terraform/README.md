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
- 버전: Terraform `>= 1.11`, Terragrunt `>= 1.1`, AWS provider `~> 6.0`. `.terraform.lock.hcl` 은 커밋합니다.

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
        ├── root.hcl                 # 공통 설정 (backend · provider 생성, state key 계산)
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

각 스택 디렉터리는 `*.tf` 와 `terragrunt.hcl` 로 이루어집니다. `backend.tf` · `providers.tf` 는 두지 않습니다 (`root.hcl` 이 생성).

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
terragrunt run --all destroy     # 역순 삭제. 10-global · 11-registry 는 제외

# 스택 하나만
cd 80-main-edge
terragrunt plan
terragrunt apply
terragrunt output -raw api_url
```

- `run --all apply · destroy` 는 대상 스택 목록을 보여주고 확인을 받습니다. 확인 없이 진행하려면 `--non-interactive` 를 붙입니다.
- `run --all apply` 는 🔒 `10-global` · `11-registry` 도 포함합니다. 변경이 없으면 No changes 로 끝납니다.
- `10-global` · `11-registry` 는 `exclude`(destroy) 로 `run --all destroy` 에서 빠지고, `prevent_destroy` 로 스택 디렉터리에서 직접 `terragrunt destroy` 해도 막힙니다.
- **`TG_PROVIDER_CACHE=1` 을 켭니다.** 끄면 스택마다 캐시 디렉터리에 AWS provider 를 따로 받아 스택당 약 760MB 를 쓰고 첫 실행이 오래 걸립니다. 켜면 provider 를 한 번만 받아 공유합니다 (`run --all plan` 캐시가 찬 상태 약 1분).
- **provider 버전은 모든 스택이 같게 맞춥니다.** lock 파일이 스택마다 있어서 처음 init 한 시점의 버전이 따로 고정됩니다. 버전을 올릴 때는 한 스택만 올리지 않고 전체를 한 번에 올린 뒤, 🔒 스택이 No changes 인지 확인합니다.
  ```bash
  terragrunt run --all -- init -upgrade
  ```

```
bootstrap                                  🔒 최초 1회 (terraform)
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

- `10-global` 은 도메인 없이 apply 할 수 있습니다. 도메인 구매 후 절차는 구매 계정(운영 계정 / 다른 계정)에 따라 다르며 [`dns.tf`](live/prod/10-global/dns.tf) 상단 주석을 따릅니다.
- `bootstrap`, `10-global`, `11-registry` 는 **destroy 하지 않습니다.**
  Hosted Zone 을 다시 만들면 NS 가 바뀌고, Object Lock 로그 버킷은 잠긴 객체가 남아 있으면 삭제할 수 없고, OIDC 발급자가 바뀌면 IRSA 신뢰 정책이 깨지고, ECR 을 지우면 이미지가 사라집니다.

### 스택별 소요 시간

빈 상태에서 apply, 전체 destroy 기준 실측값입니다.

| 스택 | 조건 | apply | destroy |
|---|---|---|---|
| `20-network` | `single_nat_gateway = true` (NAT 3개, 기본값) | 2분 13초 – 2분 35초 | 1분 45초 – 1분 52초 |
| `20-network` | `single_nat_gateway = false` (NAT 5개) | 2분 27초 | 1분 23초 |
| `30-security` | `enable_control_plane = true` (SG 6개, 규칙 26개) | 14초 – 20초 | 14초 – 15초 |
| `70-main-cluster-kubeadm` | CP 3대(AZ 별 ASG), 워커 2대 (부트스트랩 포함) | 3분 16초 – 4분 05초 | 1분 40초 – 2분 33초 |
| `80-main-edge` | 도메인 구매 전 (HTTP, ALB · WAF) | 2분 28초 – 2분 49초 | 26초 – 37초 |
| **`run --all` (10 · 11 포함, 20 · 30 · 70 · 80)** | 위 기본 조건 | **10분 06초** | **5분 01초** (10 · 11 제외) |

`70-main-cluster-kubeadm` 은 apply 가 끝난 뒤에도 노드 부트스트랩이 이어집니다 (6절). **apply 시작부터 노드 5대 Ready 까지 약 6분 – 7분, 배포 agent 의 Traefik · whoami 설치 완료까지 약 7분 – 8분** (apply 중 내부 NLB 생성이 약 2분 45초 – 3분 20초, 노드 부팅 후 부트스트랩 약 3분 – 5분). 워커 1대 종료 후 교체 워커 Ready 까지 약 2분 30초 – 3분 (종료 전 drain 포함, 6절).

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
- 본문 8KB 초과 요청은 `waf_large_body_path_regex`(기본: 객실 등록 · 수정 `/api/hotels/<id>/rooms[/<id>]`, Base64 이미지) 경로만 허용하고 나머지는 403 입니다. 큰 본문을 받는 API 가 생기면 이 정규식에 추가합니다.
- 액세스 로그는 `10-global` 로그 버킷 `alb/` 에 5분 단위로 쌓입니다. Object Lock 버킷이라 잠금 기간(7일) 동안 지워지지 않습니다.
- unhealthy 타깃이 있으면 그 워커가 클러스터에 join 했는지(`kubectl get nodes`) 먼저 봅니다 (6절). join 하지 못한 워커는 kube-proxy 가 없어 NodePort 가 응답하지 않습니다.
