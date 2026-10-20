# infra/ansible — Tailscale 기반 kubeadm 클러스터 / DB 노드 / GitLab / 결제 노드 구성

팀원들이 **각자의 로컬 PC에서 띄운 VM**을 Tailscale Tailnet으로 묶어 하나의 kubeadm 클러스터와 DB 노드, GitLab / GitLab Runner 노드, 결제 서버 노드를 만듭니다.

| Playbook | 대상 | 하는 일 |
|---|---|---|
| `control-plane.yml` | `[control_plane]` (1대) | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm init` → Calico(VXLAN) 설치 → worker용 `join.env` 생성 |
| `worker-join.yml` | `[workers]` | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm join` |
| `db.yml` | `[db]` (1대) | Tailscale 등록(`tag:db`) → Docker → ufw → MariaDB + Valkey + MinIO (Docker Compose) → dev 시딩(`--tags seed`, 스키마가 있을 때만) — [7절](#7-db-노드-구성-mariadb--valkey--minio) |
| `gitlab.yml` | `[gitlab]` (1대) | Tailscale 등록(`tag:gitlab`) → Docker → ufw → GitLab CE (Docker Compose) → `tailscale serve` HTTPS → Runner 토큰 발급 — [8절](#8-gitlab-노드-구성) |
| `gitlab-runner.yml` | `[gitlab_runner]` (1대) | Tailscale 등록(`tag:gitlab-runner`) → Docker → ufw → GitLab Runner (docker executor) 등록 — [9절](#9-gitlab-runner-노드-구성) |
| `payment.yml` | `[payment]` (1대) | Tailscale 등록(`tag:payment`) → Docker → ufw → 결제 MariaDB + ElasticMQ → Flyway → payment-service (Docker Compose, GitLab Registry 이미지) — [14절](#14-결제-서버-노드-결제-db--payment-service--elasticmq) |
| `ingress.yml` | `[control_plane]` (1대) | helm 설치 → Traefik Ingress Controller (NodePort 30080) — [11절](#11-ingress-controller-traefik) |
| `k8s-cicd.yml` | `[control_plane]` (1대) | GitLab Agent(agentk) 설치 → `backend` 네임스페이스 / CI 배포 RBAC → 레지스트리 pull Secret · `backend-secrets` — [12절](#12-cicd-kas--registry--agent--파이프라인) |
| `registry-trust.yml` | `[control_plane]`, `[workers]` | containerd `certs.d` 설정 (사설 CA 를 쓸 때 레지스트리 CA 신뢰) — [12-7](#12-7-사설-ca-를-쓸-때-선택) |
| `ingress.yml` | `[control_plane]` (1대) | helm 설치 → Traefik Ingress Controller (NodePort 30080) → api-gateway Ingress(`/api`) — [11절](#11-ingress-controller-traefik) |
| `aws-control-plane.yml` | AWS CP 노드 자신 (`inventory/aws.ini`) | **사람이 실행하지 않음.** Terraform `70-main-cluster-kubeadm` 의 user-data 가 실행. CP-a 는 마지막에 GitOps pull 배포 agent 설치 (Traefik · whoami 는 agent 가 설치) — [13절](#13-aws-main-클러스터-user-data-전용) |
| `aws-worker.yml` | AWS 워커 노드 자신 (`inventory/aws.ini`) | **사람이 실행하지 않음.** 워커 Launch Template user-data 가 실행 → `kubeadm join` — [13절](#13-aws-main-클러스터-user-data-전용) |

- OS: Ubuntu 22.04 / Kubernetes v1.33 / containerd / Calico v3.30 (tigera-operator)
- Pod CIDR `10.0.0.0/16`, Service CIDR `10.96.0.0/12`
- 모든 노드는 **Tailscale IP(100.x)** 를 node IP로 사용하며, Tailscale 태그는 `tag:k8s-node` 하나로 통일합니다.

> **비밀값은 절대 커밋하지 않습니다.** OAuth secret, join token, CA hash, API endpoint, GitLab root 비밀번호 / Runner 토큰은 모두 `.env`/`.secrets/`(gitignore 대상)에서 환경변수로만 주입됩니다.

```
infra/ansible/
├── ansible.cfg
├── .env.example               # 환경변수 이름 (값 없음)
├── control-plane.yml
├── worker-join.yml
├── db.yml
├── gitlab.yml
├── gitlab-runner.yml
├── payment.yml                # 결제 서버 노드 (14절)
├── ingress.yml
├── k8s-cicd.yml
├── registry-trust.yml
├── aws-control-plane.yml      # AWS CP user-data 전용 (13절)
├── aws-worker.yml             # AWS 워커 user-data 전용 (13절)
├── inventory/
│   ├── hosts.example.ini      # → hosts.ini 로 복사 (gitignore)
│   ├── aws.ini                # AWS 노드가 자기 자신에게 실행할 때 쓰는 inventory (13절)
│   └── group_vars/
│       ├── all.yml            # 버전·CIDR 고정값, 환경변수 매핑
│       ├── control_plane.yml  # Ingress: helm/Traefik 버전, NodePort / CI/CD: agent 버전, backend-secrets key
│       ├── db.yml             # DB 노드: 이미지 버전, 튜닝값, backend/.env 매핑, MinIO 버킷
│       ├── gitlab.yml         # GitLab 노드: 이미지 버전, 포트, Runner 태그
│       ├── gitlab_runner.yml  # Runner 노드: 버전, concurrent, GitLab 접속 정보 매핑
│       ├── payment.yml        # 결제 노드: 이미지 버전, 결제 DB / ElasticMQ 큐, 클러스터 NodePort
│       ├── aws.yml                # AWS 노드 공통: Tailscale 끔, kubelet cloud-provider, CA cert hash 대기
│       └── aws_control_plane.yml  # AWS CP: Calico MTU / 노드 IP 감지, join token 갱신 · CP reconcile 주기, CCM · NTH 버전, gitops agent 대상 브랜치
├── filter_plugins/dotenv.py   # backend/.env 파서 (parse_dotenv)
├── roles/                     # preflight, common, containerd, tailscale, kubernetes,
│                              # control_plane, calico, join_info, worker_join,
│                              # docker, firewall, db_stack, db_seed,
│                              # gitlab_stack, tailscale_serve, gitlab_runner_token, gitlab_runner,
│                              # helm, traefik, api_gateway_ingress, aws_control_plane, aws_worker, aws_node_lifecycle, gitops_sync
│                              # gitlab_bootstrap, gitlab_agent, backend_namespace, payment_stack
└── .secrets/                  # (자동 생성, gitignore) join.env, admin.conf, gitlab-runner.env,
                               # gitlab-k8s.env, github-mirror.env, payment-node.env
```

---

## 1. Tailscale 관리자 콘솔 작업 (Tailnet 관리자 1회)

### 1-1. Access controls — 태그와 접근 규칙

[Admin console → Access controls](https://login.tailscale.com/admin/acls) 의 정책 파일에 아래 내용을 **병합**합니다. (기존 `grants`/`acls` 가 있으면 지우지 말고 항목만 추가)

| 태그 | 대상 | Playbook |
|---|---|---|
| `tag:k8s-node` | control plane, worker | `control-plane.yml`, `worker-join.yml` |
| `tag:db` | DB 노드 (MariaDB + Valkey + MinIO) | `db.yml` |
| `tag:gitlab` | GitLab 노드 | `gitlab.yml` |
| `tag:gitlab-runner` | GitLab Runner 노드 | `gitlab-runner.yml` |
| `tag:payment` | 결제 서버 노드 (결제 DB + payment-service + ElasticMQ) | `payment.yml` |
| `tag:ci` | GitHub Actions runner (ephemeral, 미러링 workflow) | `.github/workflows/mirror-gitlab.yml` |

```jsonc
{
  "tagOwners": {
    // OAuth client 가 이 태그로 디바이스를 등록할 수 있게 함
    "tag:k8s-node": ["autogroup:admin"],
    "tag:db":       ["autogroup:admin"],
    "tag:gitlab":        ["autogroup:admin"],
    "tag:gitlab-runner": ["autogroup:admin"],
    "tag:payment":       ["autogroup:admin"],
    "tag:ci":            ["autogroup:admin"]
  },
  "grants": [
    // ── k8s ──────────────────────────────────────────────
    // k8s 노드끼리 전체 허용 (6443 API, 10250 kubelet, 4789/udp VXLAN, 5473 Typha 등)
    { "src": ["tag:k8s-node"], "dst": ["tag:k8s-node"], "ip": ["*"] },
    // 팀원 PC → 노드 : SSH, kubectl
    { "src": ["autogroup:member"], "dst": ["tag:k8s-node"], "ip": ["tcp:22", "tcp:6443"] },
    // (k6) 팀원 PC 에서 k8s 의 Ingress / NodePort 로 부하를 줄 때
    { "src": ["autogroup:member"], "dst": ["tag:k8s-node"], "ip": ["tcp:80", "tcp:443", "tcp:30000-32767"] },

    // ── DB ───────────────────────────────────────────────
    // k8s Pod → DB · MinIO(S3 API 9000). Pod 트래픽은 Calico natOutgoing 으로 노드 IP(100.x)로 SNAT 되어 도착
    { "src": ["tag:k8s-node"], "dst": ["tag:db"], "ip": ["tcp:3306", "tcp:6379", "tcp:9000"] },
    // GitLab CI 이미지 smoke test → dev DB 서버 (파이프라인 전용 database ci_<id> 만 사용, 12절)
    { "src": ["tag:gitlab-runner"], "dst": ["tag:db"], "ip": ["tcp:3306", "tcp:6379"] },
    // 팀원 PC → DB : SSH, DBeaver 등 DB 클라이언트, valkey-cli 디버깅, 브라우저 → MinIO presigned URL(9000) / Console(9001)
    { "src": ["autogroup:member"], "dst": ["tag:db"], "ip": ["tcp:22", "tcp:3306", "tcp:6379", "tcp:9000", "tcp:9001"] },

    // ── GitLab ───────────────────────────────────────────
    // Runner → GitLab : job 수신, git clone (HTTPS), git SSH, Container Registry(5050)
    { "src": ["tag:gitlab-runner"], "dst": ["tag:gitlab"], "ip": ["tcp:443", "tcp:2222", "tcp:5050"] },
    // k8s 노드 → GitLab : agentk ↔ KAS (443, WebSocket), containerd 이미지 pull (5050)
    { "src": ["tag:k8s-node"], "dst": ["tag:gitlab"], "ip": ["tcp:443", "tcp:5050"] },
    // GitHub Actions runner → GitLab : 코드 미러링 push (HTTPS, .github/workflows/mirror-gitlab.yml)
    { "src": ["tag:ci"], "dst": ["tag:gitlab"], "ip": ["tcp:443"] },
    // 팀원 PC → GitLab : SSH(VM 관리), 웹 UI / git (HTTPS, SSH 2222), Registry(5050)
    { "src": ["autogroup:member"], "dst": ["tag:gitlab"], "ip": ["tcp:22", "tcp:443", "tcp:2222", "tcp:5050"] },
    // 팀원 PC → Runner : SSH(VM 관리)
    { "src": ["autogroup:member"], "dst": ["tag:gitlab-runner"], "ip": ["tcp:22"] },

    // ── 결제 노드 (14절) ─────────────────────────────────
    // k8s Pod → 결제 노드 : api-gateway·booking-service → payment-service(gRPC 3004), booking-service → ElasticMQ(SQS 9324)
    { "src": ["tag:k8s-node"], "dst": ["tag:payment"], "ip": ["tcp:3004", "tcp:9324"] },
    // 결제 노드 → k8s : payment-service → booking-service(gRPC) / pg-mock-service(HTTP) NodePort
    { "src": ["tag:payment"], "dst": ["tag:k8s-node"], "ip": ["tcp:30303", "tcp:30307"] },
    // 결제 노드 → GitLab : gitops 태그 조회(443), 이미지 pull(5050)
    { "src": ["tag:payment"], "dst": ["tag:gitlab"], "ip": ["tcp:443", "tcp:5050"] },
    // 팀원 PC → 결제 노드 : SSH(VM 관리). 결제 DB 는 열지 않음 — SSH 터널로 접속
    { "src": ["autogroup:member"], "dst": ["tag:payment"], "ip": ["tcp:22"] }
  ]
}
```

### 1-2. OAuth client 생성 (용도별)

| Client | Tags | `infra/ansible/.env` 변수 | 공유 대상 |
|---|---|---|---|
| k8s 용 | `tag:k8s-node` | `TS_OAUTH_CLIENT_SECRET` | 팀원 전체 (각자 worker-join 실행) |
| DB 용 | `tag:db` | `TS_DB_OAUTH_CLIENT_SECRET` | DB 담당자 |
| GitLab 용 | `tag:gitlab` | `TS_GITLAB_OAUTH_CLIENT_SECRET` | GitLab 담당자 |
| GitLab Runner 용 | `tag:gitlab-runner` | `TS_GITLAB_RUNNER_OAUTH_CLIENT_SECRET` | Runner 담당자 |
| 결제 노드 용 | `tag:payment` | `TS_PAYMENT_OAUTH_CLIENT_SECRET` | 결제 노드 담당자 |
| GitHub Actions 용 | `tag:ci` | GitHub Repository Secret `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | 레포 관리자 ([12절](#12-cicd-kas--registry--agent--파이프라인)) |

1. [Admin console → Settings → Trust credentials (OAuth clients)](https://login.tailscale.com/admin/settings/trust-credentials) → **새 credential (OAuth)** 생성
2. Scope: **Keys → Auth Keys : Write** (Write 를 체크해야 아래에 태그 선택칸이 나타남)
3. Tags: 위 표의 태그 **하나만** 선택 (한 client 에 태그를 여러 개 지정하면 `tailscale up` 이 `requested tags [...] are invalid or not permitted` 로 실패합니다)
4. 생성 직후 표시되는 **Client secret (`tskey-client-...`)** 을 복사 — 다시 볼 수 없습니다.
5. 팀 비밀 채널(1Password, 개인 DM 등)로만 공유합니다. 커밋/이슈/Slack 공개 채널 금지.

> **용도별로 나누는 이유**: secret 을 가진 사람은 그 태그(= ACL 상의 신원)로 기기를 Tailnet 에 추가할 수 있습니다. 팀원 전체가 가진 k8s 용 secret 으로 `tag:db` 까지 만들 수 없게 분리해 두면, 한쪽이 유출돼도 다른 쪽 신원은 안전하고 교체도 독립적으로 할 수 있습니다.

> Playbook은 이 secret을 `tailscale up --auth-key=<secret>?ephemeral=false&preauthorized=true --advertise-tags=<태그>` 형태로 직접 사용합니다. 태그가 붙은 디바이스는 사용자 소유가 아니며 key expiry도 기본 비활성입니다.

### 1-3. MagicDNS / HTTPS Certificates 활성화 (GitLab HTTPS 용)

[Admin console → DNS](https://login.tailscale.com/admin/dns) 에서 **MagicDNS** 와 **HTTPS Certificates** 를 켭니다.
GitLab 노드의 `tailscale serve` 가 `<node_name>.<tailnet>.ts.net` 용 Let's Encrypt 인증서를 자동 발급·갱신하는 데 필요합니다.

> 인증서는 Certificate Transparency 로그에 공개되므로 Tailnet 이름(`<tailnet>.ts.net`)과 노드명이 외부에 노출된다는 점만 알아 두세요. (접근은 여전히 Tailnet 내부로 제한)

---

## 2. 로컬(WSL) 준비

### 2-1. Ansible 설치 및 설정 파일 복사

```bash
# WSL Ubuntu — ansible-core 2.15+ 필요 (deb822_repository 모듈)
#   Ubuntu 24.04: apt 패키지가 2.16 → 그대로 설치
sudo apt update && sudo apt install -y ansible
#   Ubuntu 22.04: apt 패키지는 2.10 이라 실패 → pipx 로 설치 (apt 의 ansible 은 먼저 제거)
#   sudo apt remove -y ansible && sudo apt install -y pipx && pipx ensurepath
#   pipx install --include-deps ansible && exec $SHELL
ansible --version                                  # 첫 줄이 ansible [core 2.15 이상] 인지 확인

cd infra/ansible
cp .env.example .env                               # TS_OAUTH_CLIENT_SECRET 채우기
cp inventory/hosts.example.ini inventory/hosts.ini # 자기 VM 정보 입력
```

- `.env` 에 `ANSIBLE_CONFIG=./ansible.cfg` 가 들어 있는 이유: WSL의 `/mnt/*` 경로는 world-writable 이라 Ansible이 현재 디렉토리의 `ansible.cfg` 를 무시하기 때문입니다.

### 2-2. SSH 키 설정

키는 **개인키 → Ansible을 실행하는 WSL**, **공개키 → VM의 `~/.ssh/authorized_keys`** 방향으로 둡니다. VM 안에서 만든 키를 꺼내 쓰지 않습니다.

```bash
# (VM) 사설 IP 확인 (ens33 등)
ip -4 addr

# (WSL) 키 생성 → 공개키를 VM에 등록 → 접속 확인
ssh-keygen -t ed25519 -f ~/.ssh/k8s_vm -C "ansible"
ssh-copy-id -i ~/.ssh/k8s_vm.pub <VM 계정>@<VM 사설 IP>
ssh -i ~/.ssh/k8s_vm <VM 계정>@<VM 사설 IP>     # 비밀번호 없이 접속되면 성공
```

- 개인키는 WSL 홈(`~/.ssh`)에 둡니다. `/mnt/c`, `/mnt/d` 아래에서는 권한을 0600으로 맞출 수 없어 ssh가 키를 거부합니다.
- **개인키 내용은 어디에도 붙여넣거나 공유하지 않습니다.** (hosts.ini에도 키 내용이 아닌 파일 경로만 적음) 노출됐다면 VM의 `authorized_keys` 에서 해당 공개키 줄을 지우고 새로 생성합니다.

### 2-3. `inventory/hosts.ini` 작성

호스트마다 계정·키가 다를 수 있으므로 호스트 줄에 접속 정보를 각각 지정합니다. (예시: [inventory/hosts.example.ini](inventory/hosts.example.ini))

```ini
[control_plane]
control-plane ansible_host=192.168.56.10 ansible_user=master ansible_ssh_private_key_file=~/.ssh/k8s_cp node_name=control-plane

[workers]
worker-taegyun ansible_host=192.168.56.11 ansible_user=taegyun ansible_ssh_private_key_file=~/.ssh/k8s_worker_taegyun node_name=worker-taegyun
```

| 항목 | 의미 |
|---|---|
| 맨 앞 이름 | Ansible 내부 호스트 별칭 |
| `ansible_host` | WSL에서 SSH로 닿는 **VM 사설 IP** (VMware NAT/Host-only 등, Tailscale IP 아님) |
| `ansible_user` | 해당 VM 접속 계정 |
| `ansible_ssh_private_key_file` | WSL에 있는 **개인키 파일 경로** |
| `node_name` | k8s 노드명 / Tailscale 호스트명 — 팀 내 중복 금지 |

각자 PC에서는 자기 VM 줄만 남기거나 `-l <호스트 별칭>` 으로 대상을 지정합니다.

### 2-4. 연결 확인

```bash
cd infra/ansible
export ANSIBLE_CONFIG=./ansible.cfg
ansible all -m ping            # 각 호스트에서 "pong" 이 나오면 성공
```

> playbook 실행 시 `-K` 는 VM의 `sudo` 비밀번호(= `ansible_user` 계정 비밀번호)를 묻는 옵션입니다.

---

## 3. Control plane 구성 (CP 담당자 1회)

```bash
cd infra/ansible
set -a; source .env; set +a
ansible-playbook control-plane.yml -K
```

완료되면 로컬에 다음 파일이 생성됩니다. (`.secrets/` 는 gitignore 대상)

| 파일 | 내용 | 용도 |
|---|---|---|
| `.secrets/join.env` | `K8S_API_ENDPOINT`, `K8S_JOIN_TOKEN`, `K8S_CA_CERT_HASH` | 팀원에게 **비밀 채널로** 전달 |
| `.secrets/admin.conf` | cluster-admin kubeconfig | Tailnet 안에서 `kubectl --kubeconfig .secrets/admin.conf ...` |

join token 유효기간은 `kubeadm_token_ttl`(기본 72h)입니다. 만료되면 token만 재발급합니다.

```bash
ansible-playbook control-plane.yml --tags join_info
```

---

## 4. Worker 구성 및 join (각 팀원)

CP 담당자에게 받은 `join.env` 를 `infra/ansible/.secrets/join.env` 에 둡니다.

```bash
cd infra/ansible
set -a; source .env; source .secrets/join.env; set +a
ansible-playbook worker-join.yml -K
```

여러 번 실행해도 안전합니다 (이미 Tailnet 접속/join 된 경우 해당 단계는 건너뜀).

---

## 5. 검증

```bash
# control plane (또는 admin.conf 를 가진 PC)
kubectl get nodes -o wide                 # STATUS Ready, INTERNAL-IP 가 100.x
kubectl get tigerastatus                  # calico, apiserver AVAILABLE=True (꺼진 워커가 있으면 calico 는 False — 정상)
kubectl get ippool -o custom-columns=NAME:.metadata.name,CIDR:.spec.cidr,IPIP:.spec.ipipMode,VXLAN:.spec.vxlanMode
                                          # CIDR 10.0.0.0/16, IPIP Never, VXLAN Always

# 노드 간 Pod 통신 (서로 다른 노드에 뜨는지 -o wide 로 확인)
kubectl run p1 --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl run p2 --image=busybox:1.36 --restart=Never -- sleep 3600
kubectl get pod -o wide
kubectl exec p1 -- ping -c 3 <p2 Pod IP>
kubectl delete pod p1 p2
```

---

## 6. 설계 메모 / 트러블슈팅

- **왜 VXLAN인가**: Tailscale(WireGuard)은 L3 터널이라 IP-in-IP(프로토콜 4) 패킷을 전달하지 않고, Pod CIDR 대역도 라우팅하지 않습니다. 그래서 Pod 트래픽을 노드 IP 사이의 UDP(4789)로 감싸는 VXLAN을 사용하고 BGP는 끕니다.
- **MTU 1230**: `tailscale0` MTU 1280 − VXLAN 헤더 50. 값이 크면 큰 패킷(이미지 pull, HTTPS 응답 등)만 멈추는 증상이 납니다.
- **Calico 노드 IP 자동탐지**: `nodeAddressAutodetectionV4.interface: tailscale0` — 사설 NIC IP가 잡히면 노드 간 VXLAN이 실패합니다.
- **Calico ↔ Tailscale fwmark 충돌**: Tailscale 은 `fwmark 0x80000/0xff0000` 이 붙은 패킷을 `main` 테이블로 보내는 ip rule 을 쓰는데, Felix 기본 mark 대역(`0xffff0000`)이 같은 비트를 씁니다. 그러면 Pod 가 Tailnet 클라이언트(100.x)에 보내는 응답이 `tailscale0` 대신 사설 NIC 의 기본 게이트웨이로 나가 버립니다 (증상: NodePort 로 SYN 은 Pod 까지 가는데 SYN-ACK 가 `ens33` 으로 나감). `calico_iptables_mark_mask: 0xff000000` 으로 Felix 를 다른 비트로 옮깁니다 (kube-proxy 는 `0x4000`/`0x8000` 이라 겹치지 않음).
- **Tailscale SNAT 끔(`--snat-subnet-routes=false`)**: 켜져 있으면 `tailscale0` 으로 들어와 Pod 로 포워딩되는 패킷을 tailscaled 가 MASQUERADE 해서 Pod 가 보는 출발지가 노드 IP 가 됩니다. 노드가 서브넷 라우터가 아니므로 꺼도 영향이 없고, Ingress(11절)의 클라이언트 IP 보존에 필요합니다.
- **join 단계에서 "연결할 수 없습니다"**: VM에서 `tailscale status` 로 control plane이 보이는지, ACL grants에서 `tag:k8s-node` 간 통신이 허용됐는지 확인합니다.
- **`tailscale up` 실패 (requested tags are invalid or not permitted)**: tagOwners 에 `tag:k8s-node` 가 없거나 OAuth client 에 해당 태그가 지정되지 않은 경우입니다.
- **join 실패 (token 관련)**: token이 만료됐을 가능성이 큽니다. CP 담당자가 `--tags join_info` 로 재발급합니다.
- **노드 재구성**: `sudo kubeadm reset -f && sudo rm -rf /etc/cni/net.d` 후 playbook을 다시 실행합니다. control plane에서는 `kubectl delete node <name>` 도 함께 합니다.

---

## 7. DB 노드 구성 (MariaDB + Valkey + MinIO)

backend 서비스가 사용할 MariaDB와, 향후 Redis를 대체할 Valkey, 객실 이미지를 저장할 dev 용 S3(MinIO)를 DB 전용 VM 1대에 Docker Compose로 띄웁니다.

| 서비스 | 이미지 | 포트 | 비고 |
|---|---|---|---|
| MariaDB | `mariadb:11.4.13` (LTS) | `DB_PORT` (3306) | backend `DB_*` 와 동일한 계정/DB |
| Valkey | `valkey/valkey:9.1.2` | 6379 | 기동만 — backend `REDIS_*` 연동은 추후 |
| MinIO | `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | 9000 (S3 API) / 9001 (Console) | dev 용 S3 — 객실 이미지 버킷. backend 연동은 추후 ([7-6](#7-6-minio-dev-용-s3)) |

- 모든 컨테이너가 `network_mode: host` 로 뜨고, **ufw 가 `tailscale0` 으로 들어오는 3306/6379/9000/9001 만 허용**합니다. (Docker 포트 publish 는 ufw 를 우회하므로 사용하지 않음)
- 데이터: `/var/lib/hotel-db/{mariadb,valkey,minio}`, 설정·자격증명: `/opt/hotel-db` (root 전용 0700)

### 7-1. VM 사양 (k6 부하 테스트 기준)

| 구분 | vCPU | RAM | Disk | 메모리 배분 |
|---|---|---|---|---|
| **권장** | 4 | 8 GB | 60 GB SSD | InnoDB buffer pool 4 GB(메모리 50%, 자동 계산) / Valkey 1 GB / OS·Docker 나머지 |
| 최소 (기능 확인용) | 2 | 4 GB | 30 GB | buffer pool 2 GB / Valkey 512 MB (`valkey_maxmemory: 512mb` 로 낮춤) |

- 커넥션: DB를 쓰는 서비스 5개(auth/booking/hotel/payment/user) × replica 수 × TypeORM(mysql2) 기본 풀 10. replica 3이면 약 150 → `max_connections=500` 으로 여유를 둡니다.
- MinIO 객체(객실 이미지)도 같은 디스크에 쌓입니다. 이미지 수가 많아지면 Disk 를 늘리세요.
- 호스트 PC는 다른 VM까지 포함해 **RAM 16 GB 이상 + SSD**, 가능하면 유선 네트워크를 권장합니다.
- k6 결과가 네트워크에 왜곡되지 않도록 k8s 노드에서 `tailscale ping <DB 노드>` 가 **direct** 로 연결되는지 확인하세요. (`via DERP` 면 중계 서버 경유라 지연이 큽니다)
- 앱 쪽 풀 크기(기본 10)를 키워야 하면 추후 backend 에 `DB_POOL_SIZE` → TypeORM `extra.connectionLimit` 를 추가합니다. (이번 범위 밖)
- 튜닝값은 `inventory/group_vars/db.yml` (`mariadb_max_connections`, `mariadb_buffer_pool_mb`, `valkey_maxmemory`) 에서 조정합니다. 느린 쿼리(1초 이상)는 `/var/lib/hotel-db/mariadb/slow.log` 에 남습니다.

> Tailscale 설정(`tag:db` ACL 규칙, DB 용 OAuth client)은 [1절](#1-tailscale-관리자-콘솔-작업-tailnet-관리자-1회)에 함께 정리되어 있습니다.

### 7-2. 값 설정 — `backend/.env` 가 단일 소스

DB 계정 정보는 **`backend/.env` 를 직접 읽습니다.** Ansible 쪽에 같은 값을 다시 적을 필요가 없습니다.

| 값 | 위치 | 비고 |
|---|---|---|
| `DB_PORT`, `DB_DATABASE`, `DB_USERNAME`, `DB_PASSWORD`, `DB_ROOT_PASSWORD` | `backend/.env` | `DB_USERNAME=root` 이면 중단 (앱 전용 계정 사용) |
| `TS_DB_OAUTH_CLIENT_SECRET` | `infra/ansible/.env` | 1-2 의 DB 용 OAuth client |
| `VALKEY_PASSWORD` | `infra/ansible/.env` | 추후 backend `REDIS_PASSWORD` 와 같은 값으로 맞출 예정 |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | `infra/ansible/.env` | MinIO 관리자 (Console 로그인). 최초 기동 때만 반영 |
| `MINIO_APP_ACCESS_KEY`, `MINIO_APP_SECRET_KEY` | `infra/ansible/.env` | 앱 전용 계정 (객실 이미지 버킷만). 추후 backend S3 접근 키와 같은 값으로 맞출 예정 |
| `BACKEND_ENV_FILE` (선택) | `infra/ansible/.env` | backend/.env 대신 다른 파일을 쓸 때 |

- 비밀번호에는 공백, 따옴표, 역슬래시, `$`, `#`, `` ` `` 를 쓸 수 없습니다. (설정 파일에 그대로 들어가기 때문)
- `MINIO_*` 는 URL 에 들어가므로 영문, 숫자, `.` `_` `~` `-` 만 씁니다. USER / ACCESS_KEY 는 3자 이상, PASSWORD / SECRET_KEY 는 8자 이상이고, 앱 계정은 root 와 달라야 합니다.
- `hosts.ini` 의 `[db]` 그룹에 DB VM 을 추가합니다. (예시: `inventory/hosts.example.ini`)

### 7-3. 실행

```bash
cd infra/ansible
set -a; source .env; set +a
ansible-playbook db.yml -K
```

마지막에 접속 정보가 출력됩니다. backend 를 온프레미스 dev 에서 띄울 때 `DB_HOST` 에 출력된 Tailscale IP 를 넣습니다.

**backend/.env 의 DB 값을 바꿨을 때**: `ansible-playbook db.yml -K` 만 다시 실행하면 됩니다.
- MariaDB 공식 이미지는 `MARIADB_*` 를 최초 초기화 때만 반영하므로, playbook 이 매번 앱 계정으로 접속을 검사하고 **실패할 때만** DB 생성 / 계정 생성 / 비밀번호 변경 / 권한 부여를 다시 수행합니다.
- 자동화하지 않는 것:
  - **`DB_ROOT_PASSWORD` 변경**: DB 노드에서 `docker exec -it mariadb mariadb -uroot -p` 로 접속해 `ALTER USER 'root'@'localhost' IDENTIFIED BY '<새 값>';` 을 실행한 뒤 backend/.env 를 바꿉니다.
  - **`DB_USERNAME` 변경 시 이전 계정 삭제**: 새 계정은 자동 생성되지만 이전 계정은 남습니다. 필요하면 `DROP USER '<이전 계정>'@'%';`

### 7-4. 검증

```bash
# DB 노드
sudo docker compose -f /opt/hotel-db/compose.yml ps        # mariadb, valkey, minio 모두 healthy
sudo ufw status                                             # 3306/6379/9000/9001 은 tailscale0 에서만 허용
sudo docker exec minio mcli ls app/room-images              # 앱 계정으로 버킷 접근 (성공해야 정상)
sudo docker exec minio mcli anonymous get local/room-images # `private` 이어야 정상

# k8s 노드 (Tailnet 경유)
nc -zv <DB Tailscale IP> 3306
nc -zv <DB Tailscale IP> 6379
curl -fsS http://<DB Tailscale IP>:9000/minio/health/live && echo ok

# k8s 안에서 Pod → DB (앱과 같은 경로)
kubectl run dbtest --rm -it --image=mariadb:11.4 --restart=Never --   mariadb -h <DB Tailscale IP> -u <DB_USERNAME> -p <DB_DATABASE> -e "SELECT 1"
kubectl run vktest --rm -it --image=valkey/valkey:9.1 --restart=Never --   valkey-cli -h <DB Tailscale IP> -a <VALKEY_PASSWORD> --no-auth-warning ping   # PONG
```

- DB VM 의 사설 IP 로 3306 / 9000 에 접속하면 **차단**되어야 정상입니다.
- 다시 실행하면 거의 모든 task 가 `ok` (changed=0 에 가까움) 로 끝나야 합니다.

### 7-5. dev DB 스키마 · 시딩

앱(user/auth/hotel/booking)은 모두 `synchronize: false` 라 **메인 DB 테이블은 Flyway 만 만듭니다.**

| 단계 | 하는 곳 | 내용 |
|---|---|---|
| 스키마 | 클러스터 — 차트의 `main-db-migration` hook Job | `deploy-dev` 때 앱보다 먼저 `main-migrations:<tag>`(backend/migrations V1~) 적용. 실패하면 배포 중단 · 롤백 |
| 초기 데이터 | DB 노드 — `db.yml --tags seed` (`db_seed` role) | `backend/scripts/seed.ts` 를 `scripts/Dockerfile.seed` 로 빌드해 1회 실행 — 관리자 계정, 호텔 3 · 객실, 편의시설, 객실 재고(오늘부터 30일) |

```bash
# 순서: db.yml(DB 기동) → GitLab 에서 deploy-dev(스키마 생성) → 시딩
cd infra/ansible
set -a; source .env; set +a
ansible-playbook db.yml -K --tags seed
```

- 관리자 계정은 `backend/.env` 의 `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` 으로 만듭니다 (비우면 관리자만 건너뜀).
- 스키마(`flyway_schema_history`, `hotels`, `admins`)가 아직 없으면 시딩을 **건너뛰고 안내만** 합니다. 그래서 `db.yml` 전체 실행에 포함되어 있어도 최초 구성이 깨지지 않습니다.
- 시딩 이미지는 로컬 `backend/` 소스 해시를 태그로 씁니다(`hotel-db-seed:<hash>`). 소스가 바뀔 때만 업로드 · 빌드하고(`node_modules`, `dist`, `.env*` 는 올리지 않음), 이전 태그는 지웁니다.
- seed.ts 는 멱등입니다. 다시 실행하면 이미 있는 관리자 · 호텔 · 편의시설 · 방별 재고는 건너뜁니다. (재고 기간을 늘리는 기능은 없음 — 재고를 새로 채우려면 해당 방의 `room_availabilities` 를 지운 뒤 다시 실행)
- **기존 dev DB 에 synchronize 로 만들어진 테이블이 남아 있으면** `main-db-migration` 이 `Found non-empty schema(s) ... but no schema history table` 로 실패합니다. dev 데이터만 있는 DB 라면 비우고 다시 배포합니다 (자동화하지 않음 — 데이터가 모두 지워짐).
  ```bash
  # DB 노드 — 확인
  sudo docker exec mariadb mariadb --defaults-extra-file=/etc/mysql/ansible/root.cnf -e "SHOW TABLES FROM <DB_DATABASE>"
  # 비우기 (database 를 지우고 db.yml 로 다시 만들면 계정 권한도 그대로 맞춰짐)
  sudo docker exec mariadb mariadb --defaults-extra-file=/etc/mysql/ansible/root.cnf -e "DROP DATABASE <DB_DATABASE>"
  ansible-playbook db.yml -K      # → deploy-dev 재실행 → db.yml -K --tags seed
  ```

### 7-6. MinIO (dev 용 S3)

객실 이미지를 MariaDB 의 Base64 컬럼(`room_images.image_base64`) 대신 S3 에 저장하도록 바꾸기 위한 dev 저장소입니다. **온프레미스에서는 객실 이미지에 관한 S3 역할(저장 · presigned URL 발급 대상 · 삭제)을 모두 MinIO 가 맡습니다.** 이번 단계는 인프라만 준비합니다.

- **이미지**: 업스트림 `minio/minio` 는 커뮤니티 이미지 배포가 끝나 Docker Hub 에서 내려갔습니다. 그래서 호환 포크 [Silo(`pgsty/minio`)](https://github.com/pgsty/minio) 를 버전을 고정해 씁니다. `MINIO_*` 환경변수, S3 API, Console 은 동일하고, 클라이언트는 `mcli`(`mc` 와 같음)입니다.
- **버킷**: `room-images` (`group_vars/db.yml` 의 `minio_bucket`). playbook 이 매번 버킷이 있는지와 **익명 접근이 꺼져 있는지(private)**를 확인합니다.
- **앱 계정**: `MINIO_APP_ACCESS_KEY` 에 `hotel-app` 정책을 붙입니다. 이 정책은 버킷 하나에 Get / Put / Delete / List 만 허용합니다. MariaDB 와 같은 방식으로, 앱 계정으로 접속을 검사해 **실패할 때만** 계정 생성 · secret 갱신 · 정책 부여를 다시 합니다.
- **접근 방식: presigned URL** — backend 가 앱 키로 서명한 URL 을 발급하면, 브라우저와 Pod 가 tailnet 으로 `:9000` 에 직접 접근합니다. 서명에 Host 가 들어가므로 **backend 의 endpoint 와 브라우저가 접근하는 주소가 같아야** 합니다(DB 노드 Tailscale IP).
- **환경변수 (예정, 이름은 backend 연동 때 확정)**

  | 이름 | dev (MinIO) | prod (AWS S3) |
  |---|---|---|
  | `S3_ENDPOINT` | `http://<DB ts ip>:9000` | 비움 → AWS SDK 기본 엔드포인트 |
  | `S3_REGION` | `ap-northeast-2` | 실제 리전 |
  | `S3_BUCKET` | `room-images` | (미정) |
  | `S3_FORCE_PATH_STYLE` | `true` | `false` |
  | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | `MINIO_APP_ACCESS_KEY` / `MINIO_APP_SECRET_KEY` | 넣지 않음 (IAM 역할) |

- **CORS**: `minio_cors_allow_origin: "*"`(서버 전역)입니다.
- **자동화하지 않는 것**: `MINIO_ROOT_PASSWORD` 변경. root 자격증명은 데이터 디렉토리가 빈 상태로 처음 기동할 때만 반영됩니다. 값을 바꾸려면 Console 이나 `mcli admin` 으로 직접 변경한 뒤 `.env` 를 맞춥니다.
- presigned 동작 확인 (DB 노드):
  ```bash
  echo hello | sudo docker exec -i minio mcli pipe app/room-images/test.txt
  # 서명 Host 가 Tailscale IP 가 되도록 앱 키로 alias 를 잡아 발급 (127.0.0.1 로 발급하면 외부에서 못 씀)
  sudo docker exec -it minio sh -c 'mcli alias set ts http://<DB ts ip>:9000 <APP_KEY> <APP_SECRET> >/dev/null && mcli share download ts/room-images/test.txt'
  # 팀원 PC: 출력된 URL → 200, 서명 없이 http://<DB ts ip>:9000/room-images/test.txt → 403
  ```

---

## 8. GitLab 노드 구성

GitHub Actions 가 미러링한 코드로 CI(테스트 → 이미지 빌드 → GitLab Container Registry push → dev 클러스터 배포)를 돌릴 온프레미스 GitLab 을 GitLab 전용 VM 1대에 Docker Compose 로 띄웁니다.
파이프라인 · 클러스터 연결(agent) 은 [12절](#12-cicd-kas--registry--agent--파이프라인)에 정리되어 있습니다.

```
GitHub Actions ──(Tailscale OAuth, tag:ci)──▶ https://gitlab.<tailnet>.ts.net ◀──(tag:gitlab-runner)── GitLab Runner
                                                  │ tailscale serve :443  (TLS 종료, 인증서 자동 갱신) → 127.0.0.1:8080 → GitLab / KAS
                                                  │ tailscale serve :5050 (Container Registry)        → 127.0.0.1:5050 → registry
                                                  ▼
                                          GitLab CE 컨테이너 (http)
```

| 항목 | 값 |
|---|---|
| 이미지 | `gitlab/gitlab-ce:19.4.2-ce.0` (`inventory/group_vars/gitlab.yml` 의 `gitlab_image`) |
| URL | `https://<node_name>.<tailnet>.ts.net` — `tailscale serve` 가 443 에서 TLS 종료 |
| git SSH | `ssh://git@<fqdn>:2222/...` — `tailscale serve` TCP 2222 포워딩 |
| Registry | `<fqdn>:5050` — `tailscale serve` HTTPS 5050 |
| KAS | `wss://<fqdn>/-/kubernetes-agent/` — 내장 nginx 가 WebSocket 업그레이드 포함 프록시 |
| 포트 publish | `127.0.0.1:8080`, `127.0.0.1:2222`, `127.0.0.1:5050` (loopback 전용, 사설 IP 로는 접근 불가) |
| ufw | SSH, 41641/udp, `tailscale0` 의 443 / 2222 / 5050 만 허용 |
| 경로 | 설정 `/opt/gitlab` (0700), 데이터 `/var/lib/gitlab/{config,logs,data}` |
| 비활성 기능 | Pages, 내장 Prometheus, usage ping, 외부 회원가입 |

### 8-1. VM 사양

| 구분 | vCPU | RAM | Disk |
|---|---|---|---|
| **권장** | 4 | 8 GB | 50 GB 이상 SSD |
| 최소 | 2 | 4 GB (+ swap 2 GB) | 30 GB — `gitlab_puma_workers: 0`, `gitlab_sidekiq_concurrency: 5` 로 낮춤 |

> 4 GB 미만이면 `gitlab.yml` 이 시작 단계에서 중단합니다 (`gitlab_min_memory_mb`). 2 GB 에서는 swap 으로 버티다 puma 가 뜨지 못해 `502 Bad Gateway` 가 계속됩니다.

### 8-2. 값 설정

| 값 | 위치 | 비고 |
|---|---|---|
| `TS_GITLAB_OAUTH_CLIENT_SECRET` | `infra/ansible/.env` | 1-2 의 GitLab 용 OAuth client (`tag:gitlab`) |
| `GITLAB_ROOT_PASSWORD` | `infra/ansible/.env` | 8자 이상, 공백·따옴표·역슬래시·`$`·`#`·`` ` `` 불가 |

- `hosts.ini` 의 `[gitlab]` 그룹에 VM 을 추가합니다. `node_name` 이 Tailscale 호스트명 = URL 앞부분이 됩니다. (예시: `inventory/hosts.example.ini`)
- 1-3 의 **HTTPS Certificates 활성화가 선행**되어야 합니다.

### 8-3. 실행

```bash
cd infra/ansible
set -a; source .env; set +a
ansible-playbook gitlab.yml -K
```

- 첫 기동은 GitLab 초기화 때문에 **5~10분** 걸립니다. (`docker compose up --wait` 가 healthy 까지 대기)
- 마지막에 GitLab URL 이 출력되고, Runner 노드용 접속 정보가 로컬 **`.secrets/gitlab-runner.env`** 로 생성됩니다.

| 파일 | 내용 | 용도 |
|---|---|---|
| `.secrets/gitlab-runner.env` | `GITLAB_URL`, `GITLAB_TS_IP`, `GITLAB_RUNNER_TOKEN` | Runner 담당자에게 **비밀 채널로** 전달 |

- Runner 는 `gitlab_runner_description`(기본 `gitlab-runner`) 이름의 **instance runner** 로 생성되며, 재실행 시 같은 runner 를 재사용합니다. 토큰만 다시 뽑으려면:
  ```bash
  ansible-playbook gitlab.yml -K --tags runner_token
  ```
- 토큰을 교체(유출 등)하려면 GitLab Admin → CI/CD → Runners 에서 해당 runner 를 삭제한 뒤 위 명령을 다시 실행하고, Runner 노드에서 9-2 를 재실행합니다.
- **`GITLAB_ROOT_PASSWORD` 는 최초 초기화 때만 반영**됩니다. 이후 변경은 UI(Admin → Users → root) 에서 합니다.
  - GitLab 은 **흔한 단어·패턴이 들어간 비밀번호를 거부**합니다(`Password must not contain commonly used combinations of words and letters`). 이 경우 root 계정이 만들어지지 않은 채 초기화가 끝나므로, `openssl rand -base64 18 | tr -d '/+='` 같은 무작위 값을 쓰세요.
  - 거부됐다면 VM 에서 `sudo docker compose -f /opt/gitlab/compose.yml down && sudo rm -rf /var/lib/gitlab` 로 초기화한 뒤 비밀번호를 바꿔 다시 실행합니다. (최초 구성 단계에서만 — 데이터가 모두 지워짐)

### 8-4. 검증

```bash
# 팀원 PC (Tailnet 접속 상태)
curl -fsS -o /dev/null -w '%{http_code}\n' https://<gitlab fqdn>/users/sign_in   # 유효한 인증서로 200
# (/-/readiness 등 health 엔드포인트는 컨테이너 내부에서만 허용 → 외부에서는 404 가 정상)
# 내부 상태: sudo docker exec gitlab curl -fsS http://localhost/-/readiness
# 브라우저로 https://<gitlab fqdn> 접속 → root / GITLAB_ROOT_PASSWORD 로그인

# GitLab 노드
sudo docker compose -f /opt/gitlab/compose.yml ps    # gitlab healthy
sudo tailscale serve status                          # https:443 → 127.0.0.1:8080, tcp:2222
sudo ufw status
```

- 같은 LAN 에서 GitLab VM **사설 IP** 의 80/443/8080 으로 접속하면 **차단**되어야 정상입니다.
- 다시 실행하면 runner 생성 없이 거의 모든 task 가 `ok` 로 끝나야 합니다.

---

## 9. GitLab Runner 노드 구성

Runner 전용 VM 1대에 GitLab Runner(apt 패키지)를 설치하고 8절에서 발급된 토큰으로 등록합니다.

| 항목 | 값 |
|---|---|
| 버전 | `gitlab-runner 19.4.1` (GitLab 과 major.minor 맞춤, `inventory/group_vars/gitlab_runner.yml`) |
| executor | `docker` + **`/var/run/docker.sock` 바인드** (job 안에서 `docker build/push` 가 호스트 Docker 로 실행) |
| 동시 job | `gitlab_runner_concurrent: 2` |
| GitLab 주소 | job / helper 컨테이너에 `extra_hosts` 로 `<gitlab fqdn>:<GitLab Tailscale IP>` 고정 (컨테이너 안의 MagicDNS 해석에 의존하지 않음) |
| 정리 | 주간 cron 으로 7일 지난 빌드 캐시 / 이미지 prune |
| ufw | SSH, 41641/udp 만 허용 (인바운드 서비스 없음) |

> **docker.sock 바인드의 트레이드오프**: DinD(privileged) 없이 빠르고 레이어 캐시를 공유하지만, job 이 **호스트 Docker 전체 권한**(= 사실상 Runner VM root)을 가집니다.
> 이 GitLab 에는 우리 레포 미러만 올리고, runner 는 신뢰된 프로젝트에서만 쓰는 것을 전제로 합니다. 외부 기여자 코드를 돌리게 되면 executor 를 재검토합니다.

### 9-1. VM 사양

| 구분 | vCPU | RAM | Disk |
|---|---|---|---|
| **권장** | 4 | 8 GB | 50 GB 이상 SSD (이미지 빌드 캐시) |
| 최소 | 2 | 4 GB | 30 GB — `gitlab_runner_concurrent: 1` |

### 9-2. 실행

8절에서 받은 `gitlab-runner.env` 를 `infra/ansible/.secrets/gitlab-runner.env` 에 두고, `hosts.ini` 의 `[gitlab_runner]` 에 VM 을 추가합니다.
`infra/ansible/.env` 에는 1-2 의 Runner 용 OAuth client secret(`TS_GITLAB_RUNNER_OAUTH_CLIENT_SECRET`, `tag:gitlab-runner`)을 채웁니다.

```bash
cd infra/ansible
set -a; source .env; source .secrets/gitlab-runner.env; set +a
ansible-playbook gitlab-runner.yml -K
```

### 9-3. 검증

```bash
# Runner 노드
sudo gitlab-runner verify                 # ... is valid
sudo gitlab-runner list
```

- GitLab Admin → CI/CD → Runners 에서 runner 가 **Online** 이면 성공입니다.
- (선택) 임시 프로젝트에 아래 `.gitlab-ci.yml` 로 clone · docker.sock 동작을 확인한 뒤 프로젝트를 삭제합니다.
  ```yaml
  smoke:
    image: docker:28-cli
    script:
      - docker info --format '{{.ServerVersion}}'
      - git -C "$CI_PROJECT_DIR" log -1 --oneline || true
  ```

### 9-4. 다음 단계

- 미러링 workflow, `.gitlab-ci.yml`, 클러스터 agent 연결은 [12절](#12-cicd-kas--registry--agent--파이프라인) 참고

---

## 10. GitLab / Runner 트러블슈팅

- **`tailscale serve` 단계에서 timeout**: HTTPS Certificates 가 꺼져 있으면 serve 가 활성화 URL 을 띄우고 멈춥니다. 1-3 을 확인한 뒤 다시 실행합니다.
- **HTTPS 응답 확인 단계 실패**: 첫 인증서 발급(Let's Encrypt)은 수십 초 걸릴 수 있습니다. VM 에서 `sudo tailscale cert <fqdn>` 로 발급 에러를 직접 확인할 수 있습니다.
- **URL 이 `gitlab-1.<tailnet>.ts.net` 처럼 바뀜**: 같은 호스트명의 기기가 이미 Tailnet 에 있으면 `-1` 이 붙습니다. Admin console 에서 이전 기기를 지우고 VM 에서 `sudo tailscale set --hostname=<node_name>` 후 `gitlab.yml` 을 재실행합니다. (external_url 이 바뀌므로 Runner 도 9-2 재실행)
- **job 의 git clone / docker push 가 중간에 멈춤**: 컨테이너 MTU(1500) 와 `tailscale0`(1280) 차이로 큰 패킷이 막히는 경우입니다. Runner 노드 `/etc/docker/daemon.json` 에 `"mtu": 1280` 을 추가하는 방향으로 대응합니다.
- **Runner 가 Offline**: Runner 노드에서 `tailscale ping <gitlab fqdn>` 과 ACL(`tag:gitlab-runner → tag:gitlab tcp:443`) 을 확인합니다.

---

## 11. Ingress Controller (Traefik)

개발자는 각자 PC 에서 `npm run dev` 로 프론트를 띄우고, Vite proxy 로 `/api` 요청을 클러스터의 api-gateway 로 넘깁니다. 이 진입점을 control plane 의 Traefik(NodePort `30080`)이 받습니다.

```
개발자 PC 브라우저 → localhost:5173 (Vite)
                      └─ /api/* proxy ──Tailnet──▶ <control-plane>.<tailnet>.ts.net:30080
                                                    └▶ Traefik → Ingress(/api, /api-docs) → api-gateway:3000
```

| 항목 | 값 | 이유 |
|---|---|---|
| 배치 | control plane 1대 고정 (`nodeSelector` + taint `toleration`) | 워커는 팀원 PC 라 꺼질 수 있음 |
| Service | `NodePort 30080`, `externalTrafficPolicy: Local` | kube-proxy SNAT 없이 개발자 PC 의 Tailscale IP 를 보존 → api-gateway rate limit 이 사용자별로 동작 |
| `forwardedHeaders.trustedIPs` | 미설정 | Vite proxy 가 붙이는 `X-Forwarded-For`(127.0.0.1)를 버리고 실제 접속 IP 로 다시 씀 |
| websecure(443) | 노출 안 함 | Tailnet 구간은 WireGuard 로 암호화. HTTPS 가 필요하면 앞단에 `tailscale serve` |
| CORS / body 제한 | 설정 안 함 | CORS 는 api-gateway(Nest) 가 전담 (중복 시 헤더 2번 → 브라우저 거부). 객실 이미지(Base64, 최대 20MB) 업로드 허용 |

- ACL 은 1-1 의 `autogroup:member → tag:k8s-node tcp:30000-32767` 로 충분하고, control plane 에는 ufw 가 없어 방화벽 작업이 필요 없습니다.
- api-gateway Ingress(`/api`, `/api-docs`)는 backend Helm 차트가 `backend` 네임스페이스에 만듭니다 (GitLab CI `deploy-dev`, [12절](#12-cicd-kas--registry--agent--파이프라인)). 이 playbook 은 Traefik 만 관리합니다.

### 11-1. 값 설정

`inventory/group_vars/control_plane.yml` — 버전(`helm_version`, `traefik_chart_version`), NodePort, api-gateway namespace / Service / 포트, Swagger(`/api-docs`) 노출 여부.

### 11-2. 실행

```bash
cd infra/ansible
set -a; source .env; set +a      # 비밀값은 안 쓰지만 ANSIBLE_CONFIG(2-1) 때문에 필요
ansible-playbook ingress.yml -K
```

- control plane 이 구성돼 있어야 합니다 (3절).
- 여러 번 실행해도 안전합니다. 설치된 chart 버전과 values 가 같으면 `helm upgrade` 를 건너뜁니다.
- 마지막 출력의 **Vite proxy target**(`http://<control-plane>.<tailnet>.ts.net:30080`)을 프론트엔드 개발자에게 전달합니다.

### 11-3. 검증

```bash
# control plane
kubectl -n traefik get pods -o wide            # NODE 가 control plane
kubectl -n traefik get svc traefik             # 80:30080/TCP, NodePort
kubectl get ingressclass traefik
kubectl -n backend get ingress api-gateway     # CLASS traefik (deploy-dev 이후)

# 개발자 PC (Tailnet)
curl -i http://<control-plane>.<tailnet>.ts.net:30080/   # Traefik "404 page not found" → 컨트롤러 도달 OK
```

클라이언트 IP 보존은 `kubectl -n traefik logs deploy/traefik --tail=5` 의 access log client IP 가 개발자 PC 의 Tailscale IP(100.x)인지로 확인합니다.

api-gateway 배포(12절 `deploy-dev`) 후에는 `curl .../api/users/hello` → 200, 브라우저로 `.../api-docs` → Swagger.

### 11-4. 트러블슈팅 / 추후 작업

- **curl 이 timeout (TCP 연결이 안 맺어짐)**: control plane 에서 `sudo tcpdump -ni any 'tcp port 30080 or tcp port 8000'` → SYN-ACK 가 `tailscale0` 이 아닌 `ens33` 으로 나가면 6절의 fwmark 충돌입니다. `control-plane.yml` / `worker-join.yml` 을 재실행해 Felix mark 대역과 Tailscale SNAT 설정을 반영합니다.
- **curl 이 timeout (그 외)**: 개발자 PC 에서 `tailscale ping <control-plane>` 확인 → ACL(1-1) 의 NodePort 범위 grant 확인. `externalTrafficPolicy: Local` 이라 **control plane 이 아닌 노드 주소로는 응답하지 않습니다.**
- **`/api/...` 가 404**: Ingress 와 Service 의 namespace / 이름 / 포트가 `control_plane.yml` 값과 같은지 확인합니다 (`kubectl -n traefik logs deploy/traefik` 에 원인이 찍힘). Service 는 있는데 Pod 가 없으면 503 입니다.
- **ArgoCD 도입 후**: Traefik 자체는 계속 이 playbook 으로 관리하거나 ArgoCD 로 함께 이관합니다.
- **HTTPS 가 필요해지면**: control plane 에서 `tailscale serve --https=443 http://<control plane Tailscale IP>:30080` (127.0.0.1 은 NodePort 동작이 kube-proxy 설정에 좌우되므로 노드 IP 사용). 이 경우 Traefik 이 보는 출발지가 노드 IP 하나가 되므로 Traefik `trustedIPs` 와 api-gateway `trust proxy` 에 노드 IP 를 추가해야 사용자별 rate limit 이 유지됩니다.

---

## 12. CI/CD (KAS · Registry · agent · 파이프라인)

GitHub 모노레포 → GitLab 미러 → GitLab 파이프라인이 테스트 · 이미지 빌드 · 레지스트리 push · dev 클러스터 배포까지 합니다.
ArgoCD 도입 전 단계라 CI 가 클러스터에 직접 배포(push 방식)하지만, 배포 상태(이미지 태그·values)는 별도 gitops 레포에 커밋해 두어 나중에 ArgoCD 가 그대로 이어받을 수 있게 했습니다.

```
GitHub push(develop|main)
  └ .github/workflows/mirror-gitlab.yml ──(Tailscale tag:ci)──▶ GitLab team04/hotel (같은 브랜치 force push)
GitLab 파이프라인 (.gitlab-ci.yml)
  test       : lint · jest (non-blocking) · nest build · helm lint
  build      : kaniko × 10 → <registry>/team04/hotel/<svc>:ci-<sha>       (develop 만 push, 서비스 8 + main/payment-migrations)
  image-test : ci_<id>(결제) · ci_main_<id>(메인) DB 생성 → flyway(main, payment) → 후보 이미지 기동 → GET /health
  push       : crane tag ci-<sha> → <sha>                                  (레이어 재업로드 없음)
  deploy-dev : (수동) gitops envs/dev/values.yaml 태그 커밋 → helm upgrade --atomic (pre hook: main-db-migration) → rollout status
               └ ci_access ──▶ KAS ──▶ dev-agent(agentk, 온프레미스) ──▶ namespace backend
```

| 구성 요소 | 위치 | 관리 |
|---|---|---|
| 미러 workflow | `.github/workflows/mirror-gitlab.yml` | GitHub |
| 파이프라인 | `.gitlab-ci.yml` (레포 루트) | GitHub → 미러 |
| Helm 차트 | `backend-deploy/charts/backend` | GitHub → 미러 |
| dev values · 이미지 태그 | GitLab `team04/infra/backend-gitops` 의 `envs/dev/values.yaml` | CI deploy-dev job 이 커밋 (초기본: `backend-deploy/gitops-seed`) |
| prod values · 이미지 태그 | GitHub 별도 prod gitops 레포 | PR 로만 변경 (보호 규칙) — GitLab 은 관여하지 않음 |
| agent 설정 (`ci_access`) | `infra/gitlab/k8s-agents` → GitLab `team04/infra/k8s-agents` | Ansible `gitlab.yml --tags bootstrap` |
| agentk · RBAC · Secret | 온프레미스 클러스터 | Ansible `k8s-cicd.yml` |

| 결정 | 내용 |
|---|---|
| 환경 | dev = 온프레미스(`dev-agent`, 이 파이프라인이 배포), prod = AWS EKS(배포 상태는 GitHub prod gitops 레포 — GitLab 은 배포하지 않음). 네임스페이스는 둘 다 `backend` |
| 브랜치 | develop → dev 빌드·smoke test·배포(수동 `when: manual`, `resource_group` 으로 직렬화). main → prod 이미지 빌드 검증 (ECR push 는 prod 구성 후 추가) |
| 이미지 태그 | 커밋 SHA (`$CI_COMMIT_SHORT_SHA`). `latest` 는 차트가 렌더링을 거부 |
| 클러스터 권한 | GitLab CE(Free)에는 ci_access impersonation 이 없어 **CI 권한 = agentk ServiceAccount 권한** → 차트 기본 cluster-admin 을 끄고 `backend` 네임스페이스 Role 만 부여 |
| smoke test DB | dev DB 서버를 쓰되 database 는 파이프라인 전용(`ci_<id>` 결제, `ci_main_<id>` 메인). 후보 이미지의 마이그레이션을 빈 DB 에 처음부터 적용해 검증하고, dev 데이터와 분리하기 위해 |

### 12-1. GitLab: KAS · Registry · 부트스트랩 (GitLab 담당자)

`gitlab.yml` 이 KAS 와 Container Registry(`<fqdn>:5050`)를 켜고, `gitlab_bootstrap` role 이 REST API 로 아래를 멱등하게 맞춥니다.

- 그룹 `team04`, `team04/infra` / 프로젝트 `team04/hotel`(미러), `team04/infra/k8s-agents`, `team04/infra/backend-gitops`
  - `ci_access` 를 받는 프로젝트는 agent 설정 프로젝트와 **같은 최상위 그룹**에 있어야 해서 `team04` 하나로 묶었습니다.
- agent `dev-agent` 등록과 토큰 발급, gitops 레포(dev 전용) 초기 values 커밋(레포가 비어 있을 때만)
- 그룹 Deploy Token(`read_registry`) — 클러스터 imagePullSecret 용
- `team04/hotel` CI 변수: `GITOPS_PUSH_TOKEN`(gitops 레포 Project Access Token), `SMOKE_DB_*`, `SMOKE_REDIS_*` (모두 protected)
- 미러용 Project Access Token, `main`/`develop` 보호 브랜치(force push 허용), 레지스트리 cleanup policy(`ci-*` 후보 태그·kaniko 캐시 7일)

```bash
cd infra/ansible
set -a; source .env; set +a          # CI_SMOKE_DB_PASSWORD, DB_TS_IP 포함 (12-2)
ansible-playbook gitlab.yml -K                   # KAS/Registry 반영 (gitlab.rb 가 바뀌면 컨테이너 재생성, 수 분)
ansible-playbook gitlab.yml -K --tags bootstrap  # 부트스트랩만 다시
```

- 결과: `.secrets/gitlab-k8s.env`(agent 토큰, Deploy Token → 12-3), `.secrets/github-mirror.env`(미러 토큰 → 12-4), `.secrets/payment-node.env`(결제 노드 Deploy Token → 14-2). 커밋 금지, 팀 비밀 채널로만 공유합니다.
- 토큰 교체: 해당 줄을 비우고(또는 CI 변수 `GITOPS_PUSH_TOKEN` 을 삭제하고) 다시 실행하면 그 토큰만 재발급하고 기존 것은 폐기합니다. Project Access Token 은 364일 뒤 만료됩니다.
- Tailscale ACL(1-1)에 `tag:k8s-node → tag:gitlab tcp:443,5050`, `tag:gitlab-runner → tag:gitlab tcp:5050`, `tag:gitlab-runner → tag:db tcp:3306,6379` 가 있어야 합니다.

### 12-2. DB: smoke test 전용 계정 (DB 담당자)

`.env` 에 `CI_SMOKE_DB_PASSWORD` 를 채우고 `db.yml` 을 다시 실행하면 `ci_smoke` 계정이 생깁니다. 권한은 이름이 `ci_` 로 시작하는 database 에만 있어서 dev 앱 DB 와 결제 DB 는 건드릴 수 없습니다.
같은 비밀번호와 `DB_TS_IP`(DB 노드 Tailscale IP)를 넣고 12-1 의 부트스트랩을 실행하면 CI 변수로 등록됩니다. GitLab 의 masked 변수 제약 때문에 비밀번호는 8자 이상, 영숫자 위주로 정합니다.

### 12-3. 클러스터: agent · RBAC · Secret (CP 담당자)

```bash
cd infra/ansible
set -a; source .env; source .secrets/gitlab-k8s.env; set +a
ansible-playbook k8s-cicd.yml -K
ansible-playbook k8s-cicd.yml -K --tags backend_secrets   # backend/.env 를 바꾼 뒤 Secret 만 다시
```

- `gitlab-agent` 네임스페이스에 agentk(chart `gitlab-agent` 2.32.0 = v19.4.0)를 control plane 1대에 고정해 설치합니다. `hostAliases` 로 GitLab FQDN 을 Tailscale IP 에 고정합니다(Pod 의 CoreDNS 가 MagicDNS 를 해석한다는 보장이 없음).
- `backend` 네임스페이스와 Role `cicd-deployer`(Deployment/Service/ConfigMap/Secret/Job/Ingress/HPA 등, 이 네임스페이스 안만)를 만들고, `kubectl auth can-i` 로 `backend` 허용 · `kube-system`·namespace 생성 거부를 확인합니다.
- Secret `gitlab-registry`(Deploy Token)와 `backend-secrets`(`backend/.env` 에서 차트가 쓰는 key 만, `DB_HOST`·`REDIS_HOST` 는 `DB_TS_IP` 로 덮어씀)를 만듭니다.
- **결제**: payment-service · 결제 DB · ElasticMQ 는 클러스터 밖 **결제 서버 노드**([14절](#14-결제-서버-노드-결제-db--payment-service--elasticmq))에서 운영합니다. 그래서 `backend-secrets` 에는 `PAYMENT_DB_*` 를 넣지 않고(`backend/.env` 에 채워져 있어도 제외), gitops `envs/dev/values.yaml` 에서 `services.payment-service.enabled` 와 `migrations.payment.enabled` 는 `false` 로 둡니다(초기 seed 에 반영됨).
  - 이미지 smoke test(`test:image`)는 파이프라인 전용 DB 로 payment-service 를 계속 검증합니다.

확인: GitLab `team04/infra/k8s-agents` → Operate → Kubernetes clusters 에서 `dev-agent` 가 **Connected**.

### 12-4. GitHub: 미러 workflow 설정 (레포 관리자)

GitHub 레포 Settings → Secrets and variables → Actions:

| 종류 | 이름 | 값 |
|---|---|---|
| Secret | `TS_OAUTH_CLIENT_ID` / `TS_OAUTH_SECRET` | 1-2 의 GitHub Actions 용 OAuth client (`tag:ci`) |
| Secret | `GITLAB_MIRROR_TOKEN` | `.secrets/github-mirror.env` 의 값 |
| Variable | `GITLAB_HOST` | `<gitlab node_name>.<tailnet>.ts.net` |
| Variable | `GITLAB_MIRROR_REPO` | `team04/hotel` (기본값과 같으면 생략 가능) |

develop/main 에 push 하면 같은 브랜치가 GitLab 으로 force push 됩니다. GitHub 이 원본이므로 **GitLab `team04/hotel` 에는 직접 커밋하지 않습니다** (다음 미러링 때 덮어써짐). 처음 한 번은 Actions → Mirror to GitLab → Run workflow 로 develop 을 수동 미러링합니다.

### 12-5. 파이프라인 사용

- develop 에 merge → 미러 → 파이프라인 자동 실행(test → build → image-test → push) → **`deploy-dev` 를 GitLab UI 에서 수동 실행**.
- `deploy-dev` 는 gitops 레포에 `chore(gitops): dev backend → <sha>` 를 커밋한 뒤 배포합니다. 배포가 실패하면(`--atomic` 롤백) 그 커밋을 revert 해서 gitops 레포가 항상 실제 배포 상태와 같습니다.
- 롤백: Deployments → Environments → dev 에서 이전 배포의 `deploy-dev` 를 다시 실행하면 그 SHA 로 되돌아갑니다(최종 태그 이미지는 cleanup 대상이 아님).
- lint/jest 는 기존 실패가 남아 있어 non-blocking 입니다. 정리되면 `.gitlab-ci.yml` 의 `allow_failure: true` 를 지웁니다.
- smoke test 가 실패하면 job 로그 위쪽의 service(`app`) 로그(`CI_DEBUG_SERVICES`)에서 앱 기동 오류를 확인합니다. 파이프라인이 중간에 끊겨 남은 DB 는 DB 노드에서 확인 후 `DROP DATABASE` 합니다.
  ```bash
  docker exec mariadb mariadb --defaults-extra-file=/etc/mysql/ansible/root.cnf -N \
    -e "SHOW DATABASES LIKE 'ci%'"
  ```
- prod: 이 파이프라인은 main 에서 이미지 빌드 검증만 합니다. prod 구성 후 `build` job 의 main 분기에 ECR push 를 추가하고, 배포 상태는 GitHub 의 prod gitops 레포에 PR 로 반영합니다 (GitLab 의 `deploy-prod` · `prod-agent` 는 이 결정으로 제거).

### 12-6. ArgoCD 전환 메모

- (dev) Application 은 multi-source 로 만듭니다: 차트 = `team04/hotel` 의 `backend-deploy/charts/backend`, values = `team04/infra/backend-gitops` 의 `$values/envs/dev/values.yaml`. `destination.namespace: backend`, `CreateNamespace=false`. prod 는 GitHub prod gitops 레포를 바라봅니다.
- HPA 를 켠 서비스가 있으면 `ignoreDifferences` 에 Deployment `/spec/replicas` 를 넣습니다(2nd 프로젝트에서 HPA 와 selfHeal 이 replicas 를 서로 되돌린 문제).
- 전환 후 `.gitlab-ci.yml` 의 `.deploy` 는 gitops 커밋까지만 남기고 helm/kubectl 단계를 지웁니다. agent 의 `cicd-deployer` Role 도 회수합니다.

### 12-7. 사설 CA 를 쓸 때 (선택)

기본 구성은 `tailscale serve` 의 `*.ts.net` 인증서(Let's Encrypt, 공인 CA)라 아래 작업이 필요 없습니다. GitLab 앞단을 사설 인증서로 바꾼 경우에만 `.env` 에 `PRIVATE_CA_CERT_FILE=<PEM 경로>` 를 넣고 다시 실행합니다.

| 대상 | 적용 | playbook |
|---|---|---|
| agentk | `config.kasCaCert` | `k8s-cicd.yml` |
| CI job | Runner `/etc/gitlab-runner/certs/<fqdn>.crt` → job 에 `CI_SERVER_TLS_CA_FILE` 로 전달 (kaniko 는 이 파일을 CA 번들에 추가) | `gitlab-runner.yml` |
| 모든 노드 containerd | `/etc/containerd/certs.d/<registry>/hosts.toml` + `ca.crt` | `registry-trust.yml -l <노드>` (워커는 각자) |

- Runner 의 docker.sock 바인드: backend 파이프라인은 kaniko 라 필요 없습니다. 다른 프로젝트가 docker CLI 를 쓰지 않으면 `group_vars/gitlab_runner.yml` 의 `gitlab_runner_mount_docker_sock: false` 로 바꿔 job 이 호스트 root 권한을 갖지 않게 합니다.

### 12-8. 트러블슈팅

- **agent 가 Not connected**: `kubectl -n gitlab-agent logs -l app.kubernetes.io/instance=dev-agent`. `unauthenticated` 면 토큰(12-1 재발급 후 `k8s-cicd.yml` 재실행), `dial`/timeout 이면 ACL `tag:k8s-node → tag:gitlab tcp:443` 과 `hostAliases` IP 를 확인합니다. GitLab 노드에서 `gitlab.yml` 의 "KAS WebSocket 프록시 확인" 이 502/504 면 KAS 가 안 떠 있는 것입니다(`docker exec gitlab gitlab-ctl status gitlab-kas`).
- **deploy job 이 `context ... does not exist`**: agent 설정의 `ci_access.projects` 와 job 의 `environment` 이름(dev/prod)이 맞는지, `team04/hotel` 이 `team04` 그룹 안에 있는지 확인합니다.
- **`forbidden` (deploy job)**: Role `cicd-deployer` 에 없는 리소스를 차트에 추가한 경우입니다. `roles/gitlab_agent/templates/cicd-rbac.yaml.j2` 에 추가하고 `k8s-cicd.yml` 을 다시 실행합니다.
- **ImagePullBackOff**: `kubectl -n backend describe pod` → 401 이면 `gitlab-registry` Secret(Deploy Token), `no such host` 면 노드의 MagicDNS, timeout 이면 ACL `tag:k8s-node → tag:gitlab tcp:5050` 입니다.
- **smoke test 에서 DB 접속 실패**: ACL `tag:gitlab-runner → tag:db tcp:3306,6379`, CI 변수 `SMOKE_DB_HOST`(Tailscale IP), `db.yml` 로 `ci_smoke` 계정을 만들었는지 확인합니다.

## 13. AWS Main 클러스터 (user-data 전용)

`aws-control-plane.yml`, `aws-worker.yml` 은 **사람이 실행하지 않습니다.** Terraform `70-main-cluster-kubeadm` 이 이 디렉터리를 S3 에 올리고, CP 3대와 워커 ASG 인스턴스의 user-data 가 받아서 자기 자신에게 `ansible-playbook -c local` 로 실행합니다. 부트스트랩 실패 확인 방법은 [Terraform README](../terraform/README.md) 6절을 봅니다.

- **온프레미스 절차는 그대로입니다.** AWS 차이는 `aws-*.yml`, `inventory/aws.ini`, `group_vars/aws*.yml`, `roles/aws_*`, `roles/gitops_sync` 에만 둡니다. 공용 role 은 변수만 받고 온프레미스 기본값은 그대로입니다.
- **Ansible 은 노드 작업 · Calico · CCM · NTH · 배포 agent 설치까지만 합니다.** 클러스터 서비스(Traefik · whoami, 이후 backend 등)는 CP-a 가 설치하는 GitOps pull 배포 agent 가 gitops 레포 `envs/prod`(원본: 모노레포 [`infra/gitops/prod`](../gitops/prod/README.md))에서 설치합니다. user-data 는 첫 부팅 때만 돌아서, Ansible 이 설치하면 변경이 다음 재생성까지 반영되지 않기 때문입니다. NTH 는 CCM 과 같은 role · post-renderer 를 써서 ArgoCD 전환 때 함께 옮깁니다.
- `inventory/aws.ini` 는 CP · 워커 group_vars 가 섞이지 않게 `localhost` 대신 별칭(`aws-cp`, `aws-worker`)을 쓰고, `aws-cp` 를 `control_plane` 그룹에도 넣어 helm 버전을 온프레미스와 같이 씁니다.
- S3 에는 커밋 대상 파일만 올라갑니다. `.env`, `.secrets/`, `inventory/hosts.ini` 는 올라가지 않습니다.

| 항목 | 온프레미스 (`control-plane.yml`) | AWS (`aws-control-plane.yml`) |
|---|---|---|
| `use_tailscale` | `true` (기본값) | `false` — tailscale role, `TS_OAUTH_CLIENT_SECRET` 확인 생략 |
| 노드 IP (`node_ip`) | Tailscale IP (100.x) | VPC private IP |
| 노드 이름 | `hosts.ini` 의 `node_name` | EC2 private DNS (`ip-10-10-4-10.ec2.internal`) |
| `controlPlaneEndpoint` | 노드 IP | 내부 NLB DNS (`certSANs` 에 포함) |
| CP 대수 | 1대 (`kubeadm init`) | 3대 (AZ 별 ASG) — CP-a `kubeadm init --upload-certs`, CP-b · c `kubeadm join --control-plane`. 교체된 CP 는 모두 join |
| 워커 join | 사람이 `.env` 에 `K8S_*` 를 넣고 `worker-join.yml` 실행 | ASG 인스턴스가 기동 시 `aws-worker.yml` 자동 실행 (`worker_join` role 재사용) |
| kubelet `cloud-provider` (`kubelet_cloud_provider`) | 미설정 (kubeadm 설정에 들어가지 않음) | `external` — aws-cloud-controller-manager 가 노드 초기화 (providerID, uninitialized taint 제거) |
| 이미지 pull 자격 증명 | GitLab Deploy Token Secret(`imagePullSecrets`) | 워커 kubelet 의 ecr-credential-provider(`aws_ecr_credential_provider` role, `kubelet_image_credential_provider_*`)가 워커 Role 로 ECR 토큰 발급 — `team04-hotel/*` 저장소만 pull. CP 는 설치 안 함 |
| 워커 join 재시도 (`kubeadm_join_retries`) | 0 (1회 실행) | 3 — 실패 시 `kubeadm reset` 후 30초 간격. CP-b · c 의 etcd 멤버 추가 중 apiserver 타임아웃 대비 |
| join 정보 | `.secrets/join.env` (로컬) | Parameter Store `/team04-hotel/prod/kubeadm/*` |
| Calico 노드 IP 감지 / MTU | `tailscale0` / 1230 | `NodeInternalIP` / 8951 (VPC 점보 프레임 9001 − VXLAN 50) |
| Felix mark 대역 변경 | 함 (Tailscale fwmark 충돌) | 안 함 |
| kube-apiserver `--service-account-issuer` (`k8s_service_account_issuer`) | 미설정 (kubeadm 기본값) | 10-global OIDC 버킷 URL (IRSA). CP-a 가 init 직후 SA 서명 공개키를 `keys.json` 으로 업로드 |
| 클러스터 서비스 설치 | Ansible(`ingress.yml`) · GitLab CI(`deploy-dev`) | GitOps pull 배포 agent (`gitops_sync` role 이 CP-a 부트스트랩 마지막에 설치, 워커 Ready 대기 후 첫 실행) |
| Traefik | `ingress.yml` 수동 실행 (`roles/traefik`), control plane 1대 고정, `externalTrafficPolicy: Local` | gitops `envs/prod/traefik` — 워커에 2개, `externalTrafficPolicy: Cluster`, trustedIPs = Main VPC CIDR + Pod CIDR, `/ping` 을 `web` 에 노출(`80-main-edge` 헬스체크) |
| Ingress 대상 | api-gateway (`/api`, `/api-docs`) | api-gateway (`/api`, gitops `envs/prod/backend`) + 테스트 백엔드 whoami (`/whoami`). 그 외 경로는 Traefik 404 |

**Parameter Store** (`/team04-hotel/prod/kubeadm/`)

| 이름 | 만드는 쪽 | 쓰는 쪽 |
|---|---|---|
| `join-token` (SecureString) | Terraform (랜덤, ttl 72h) → CP 3대가 12시간마다 새 token(ttl 24h)으로 덮어씀 | CP-a init 의 bootstrap token, CP-b · c · 워커 join |
| `certificate-key` (SecureString) | Terraform (랜덤) | CP-a 가 인증서를 `kubeadm-certs` Secret 으로 올릴 때 암호화 키, CP-b · c 가 내려받을 때 |
| `ca-cert-hash` (String) | Terraform 이 `pending` 으로 생성 → CP-a 가 init 후 기록 | CP-b · c · 워커가 이 값이 바뀔 때까지 기다린 뒤 join |

CP-a 는 init 후 10-global OIDC 버킷의 `keys.json` 도 덮어씁니다 (CP Role 은 이 객체 하나만 PutObject).

- `ca-cert-hash` 가 이미 기록돼 있으면 CP-a 도 init 대신 join 합니다. CP-a 만 교체됐을 때 클러스터를 새로 만들지 않게 하려는 것입니다.
- **CP 교체:** CP 는 AZ 별 ASG(1대 고정) 라 사라지면 새로 뜨고 join 합니다. CP 3대의 systemd timer `team04-cp-reconcile.timer`(1분) 가 사라진 CP 의 etcd 멤버를 지우고, init 2시간 후 삭제되는 `kubeadm-certs` Secret 을 같은 certificate-key 로 다시 올립니다. 동작 · 확인 방법 · 범위 밖(2대 이상 동시 장애, etcd 백업)은 [Terraform README](../terraform/README.md) 6절.
- **join token 갱신:** CP 마다 systemd timer `team04-renew-join-token.timer` 가 `kubeadm token create` → `join-token` 파라미터 덮어쓰기. 즉시 갱신하려면 CP 에서 `sudo systemctl start team04-renew-join-token.service`. Terraform 은 이 파라미터 값 변경을 무시합니다.
- **워커 교체 · 스케일 인:** 종료 전 drain 은 aws-node-termination-handler(NTH), 종료된 워커의 Node 삭제는 aws-cloud-controller-manager(CCM) 가 합니다. 둘 다 CP-a 부트스트랩의 `aws_node_lifecycle` role 이 CP 에 hostNetwork 로 설치합니다 (차트에 hostNetwork 값이 없어 Helm post-renderer 로 추가). 동작 · 확인 방법은 [Terraform README](../terraform/README.md) 6절.
- **배포 agent:** CronJob `gitops-sync`(1분, CP 노드)가 gitops 레포 대상 브랜치(`gitops_sync_branch`, 기본 `main`)의 SHA 가 바뀌면 `envs/prod/*/chart.yaml` 을 order 순으로 `helm upgrade --install --atomic` 합니다. 부트스트랩 Job 이 실패해도 CP 부트스트랩은 실패시키지 않습니다(CP 교체 방지). 결과는 `cloud-init-output.log` 의 "부트스트랩 결과" 와 ConfigMap `gitops-sync-state`. 첫 실행(Traefik · whoami 설치)은 NTH 설치 직후부터 적용 완료까지 약 45초 (2026-10-19 실측), 이후 변경은 push 후 1분 안팎에 반영. 동작 · 운영 · 작업 브랜치 검증은 [`infra/gitops/prod/README.md`](../gitops/prod/README.md).
- **클러스터 값:** public gitops 레포에 둘 수 없는 값(계정 ID)은 CP-a 가 STS 로 조회해 ConfigMap `gitops-sync/gitops-sync-cluster-values` 로 만듭니다 (`gitops_sync_cluster_values`). agent 는 `chart.yaml` 에 `clusterValues: true` 인 앱(pod-identity-webhook 의 IRSA Role ARN)에만 넘깁니다.
- **IRSA:** kube-apiserver 발급자를 10-global OIDC 버킷 URL 로 두고(join CP 는 `kubeadm-config` 에서 같은 값을 받음), CP-a 가 init 직후 발급자 문서의 issuer 를 확인한 뒤 `/openid/v1/jwks` 를 `keys.json` 으로 올립니다. 업로드는 `ca-cert-hash` 기록 전이라, 실패하면 교체된 CP-a 가 다시 init 합니다. webhook · ESO 는 gitops 앱, Role 은 Terraform 70 `irsa.tf` ([`infra/gitops/prod/README.md`](../gitops/prod/README.md) "IRSA · 비밀값").
- 클러스터 확인 (SSM 접속 후): `sudo kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes -o wide`
- Ingress 확인 (워커에 SSM 접속 후): `curl -i http://$(hostname -I | awk '{print $1}'):30080/whoami` → whoami 200 (`/` 는 Traefik 404 가 정상). 워커 30080 인바운드는 ALB SG 에서만 열려 있어(M2) **다른 노드에서는 연결되지 않습니다.** 노드 자신의 IP 로 확인합니다 (Traefik 파드가 다른 워커에 있어도 kube-proxy 가 넘겨 줍니다).

---

## 14. 결제 서버 노드 (결제 DB + payment-service + ElasticMQ)

결제는 메인 클러스터 · 메인 DB 와 분리된 결제 전용 VM 1대에서 운영합니다. prod(AWS)의 "결제 VPC(결제 서버 + 결제 RDS) → SQS FIFO → 메인 클러스터 booking-service" 구조를 dev 에서 같은 모양으로 재현하는 것이 목적입니다.

```
k8s(dev)      api-gateway / booking-service ──tailnet──▶ payment-node:3004  payment-service (gRPC)
              booking-service (결과 수신)    ──tailnet──▶ payment-node:9324  ElasticMQ (SQS API)
payment-node  payment-service ─▶ 127.0.0.1:3306 결제 MariaDB (loopback 전용)
              payment-service ─▶ 127.0.0.1:9324 payment-result.fifo 발행 (payment_outbox)
              payment-service ─▶ <control plane>:30303 booking-service (gRPC) / :30307 pg-mock-service (HTTP)  ← NodePort
              docker pull / git clone ─▶ <gitlab fqdn>:5050 / :443 (결제 노드 전용 Deploy Token)
```

| 구성 요소 | 이미지 | 포트 | 비고 |
|---|---|---|---|
| 결제 MariaDB | `mariadb:11.4.13` | `PAYMENT_DB_PORT`(3306) | `bind-address=127.0.0.1` — tailnet 에서도 접속 불가 |
| Flyway | `<registry>/team04/hotel/payment-migrations:<tag>` | - | payment-service 갱신 직전 `compose run --rm` 1회 |
| payment-service | `<registry>/team04/hotel/payment-service:<tag>` | 3004 (gRPC), 3104 (health, 내부) | `synchronize: false` — 테이블은 Flyway 만 만듦 |
| ElasticMQ | `softwaremill/elasticmq:1.7.1` | 9324 (SQS) | 큐 `payment-result.fifo` + DLQ `payment-result-dlq.fifo`, 큐·메시지 디스크 저장 |

- 모든 컨테이너는 `network_mode: host` 이고, ufw 가 `tailscale0` 의 **3004 · 9324 만** 허용합니다.
- 경로: 설정·자격증명 `/opt/payment-node`(0700), 데이터 `/var/lib/payment-node/{mariadb,elasticmq}`
- 이미지 태그: gitops `team04/infra/backend-gitops` 의 `envs/dev/values.yaml` → `global.imageTag` 를 따릅니다. 클러스터에 배포된 것과 같은 커밋의 이미지를 씁니다. `PAYMENT_IMAGE_TAG` 를 지정하면 그 값을 우선합니다.

### 왜 클러스터의 결제 마이그레이션(`migrations.payment`)을 끄는가

마이그레이션을 없애는 것이 아니라 **실행 위치를 결제 노드로 옮긴 것**입니다. 차트의 `migrations.payment` 는 클러스터 안 Pod 에서 Flyway 로 `PAYMENT_DB_HOST` 에 접속하는 helm hook Job 입니다. 이걸 켜 두면:

1. 결제 DB(3306)를 클러스터(tag:k8s-node)에 열어야 합니다 — DB 를 분리한 의미가 약해집니다.
2. 같은 스키마를 helm Job 과 결제 노드 두 곳이 서로 다른 시점 · 이미지 태그로 migrate 하게 됩니다.
3. `backend-secrets` 에 결제 DB 자격증명이 들어가 클러스터 쪽 노출 범위가 늘어납니다.

그래서 dev 클러스터에서는 `payment-service` 와 `migrations.payment` 를 둘 다 끄고, 결제 노드가 `payment-migrations:<tag>` 로 Flyway 를 먼저 실행한 뒤 payment-service 를 갱신합니다. Flyway 가 실패하면 payment-service 는 이전 버전 그대로 남습니다.

### 14-1. VM 사양

| 구분 | vCPU | RAM | Disk |
|---|---|---|---|
| **권장** | 2 | 4 GB | 30 GB SSD |

InnoDB buffer pool 은 메모리의 25%(자동 계산), ElasticMQ JVM heap 은 256 MB 입니다 (`group_vars/payment.yml`).

### 14-2. 값 설정

| 값 | 위치 | 비고 |
|---|---|---|
| `PAYMENT_DB_PORT`, `PAYMENT_DB_DATABASE`, `PAYMENT_DB_USERNAME`, `PAYMENT_DB_PASSWORD` | `backend/.env` | 결제 DB / 앱 계정. `PAYMENT_DB_HOST` 는 노드 안에서 `127.0.0.1` 로 덮어씀 |
| `TS_PAYMENT_OAUTH_CLIENT_SECRET` | `infra/ansible/.env` | 1-2 의 결제 노드 용 OAuth client (`tag:payment`) |
| `PAYMENT_DB_ROOT_PASSWORD` | `infra/ansible/.env` | 결제 MariaDB root. 최초 초기화 때만 반영 |
| `CLUSTER_ENTRY_IP` | `infra/ansible/.env` | control plane Tailscale IP (booking / pg-mock NodePort 호출 대상) |
| `PAYMENT_IMAGE_TAG` (선택) | `infra/ansible/.env` 또는 명령행 | 비우면 gitops 의 dev 태그 |
| `GITLAB_URL`, `GITLAB_TS_IP`, `GITLAB_REGISTRY`, `PAYMENT_DEPLOY_USER`, `PAYMENT_DEPLOY_TOKEN` | `.secrets/payment-node.env` | `gitlab.yml --tags bootstrap` 이 생성 (12-1) |

- 비밀번호에는 공백, 따옴표, 역슬래시, `$`, `#`, `` ` `` 를 쓸 수 없습니다.
- `hosts.ini` 의 `[payment]` 그룹에 VM 을 추가합니다. (예시: `inventory/hosts.example.ini`)
- 결제 노드 Deploy Token(`payment-node`, read_registry + read_repository)은 k8s 용(`k8s-registry-pull`)과 별개라 따로 폐기할 수 있습니다. `.secrets/payment-node.env` 의 `PAYMENT_DEPLOY_TOKEN` 을 비우고 부트스트랩을 다시 실행하면 재발급됩니다.

### 14-3. 실행

```bash
cd infra/ansible
set -a; source .env; source .secrets/payment-node.env; set +a
ansible-playbook payment.yml -K                   # 전체 구성
ansible-playbook payment.yml -K --tags deploy     # 이미지 태그 갱신만 (Tailscale·Docker·ufw 생략)
PAYMENT_IMAGE_TAG=<short sha> ansible-playbook payment.yml -K --tags deploy   # 특정 태그로 (롤백)
```

순서: 결제 DB · ElasticMQ 기동 → 결제 DB 계정 맞추기 → Flyway migrate → payment-service 갱신(healthy 대기). 마지막에 적용된 스키마 버전과 **gitops 에 넣을 값**(14-4)이 출력됩니다.

- `backend/.env` 의 `PAYMENT_DB_*` 를 바꿨을 때도 다시 실행하면 됩니다 — 앱 계정 접속이 실패할 때만 DB / 계정 / 비밀번호 / 권한을 다시 맞춥니다 (`db.yml` 과 같은 방식).
- **`PAYMENT_DB_ROOT_PASSWORD` 변경은 자동화하지 않습니다.** 결제 노드에서 `docker exec -it payment-mariadb mariadb -uroot -p` → `ALTER USER 'root'@'localhost' IDENTIFIED BY '<새 값>';` 후 `.env` 를 바꿉니다.

### 14-4. dev gitops 값 (최초 1회)

클러스터 쪽 서비스가 결제 노드를 찾을 수 있게 gitops `team04/infra/backend-gitops` 의 `envs/dev/values.yaml` 에 아래를 넣고 `deploy-dev` 를 실행합니다. `payment.yml` 실행 결과에 실제 IP 가 채워진 값이 출력됩니다.

```yaml
services:
  api-gateway:
    env:
      PAYMENT_SERVICE_HOST: "<payment ts ip>:3004"
  booking-service:
    nodePort: 30303                       # 결제 노드 → booking-service gRPC
    env:
      PAYMENT_SERVICE_HOST: "<payment ts ip>:3004"
      SQS_ENDPOINT: "http://<payment ts ip>:9324"
      SQS_REGION: ap-northeast-2
      PAYMENT_RESULT_QUEUE_URL: "http://<payment ts ip>:9324/000000000000/payment-result.fifo"
      AWS_ACCESS_KEY_ID: elasticmq        # ElasticMQ 용 더미 (검증 안 함)
      AWS_SECRET_ACCESS_KEY: elasticmq
  pg-mock-service:
    nodePort: 30307                       # 결제 노드 → pg-mock-service HTTP
  payment-service:
    enabled: false
migrations:
  payment:
    enabled: false
```

- **NodePort**: 결제 노드는 k8s 노드가 아니라서 `booking-service:3003` 같은 ClusterIP · 클러스터 DNS 에 닿을 수 없습니다. 차트는 `nodePort` 를 지정한 서비스만 `type: NodePort` 로 만들고(ClusterIP 도 그대로 유지), 지정하지 않은 서비스는 지금처럼 ClusterIP 입니다.
- 새로 만드는 gitops 레포는 `backend-deploy/gitops-seed` 에 NodePort 와 위 값의 주석이 들어 있습니다. IP 만 채우면 됩니다.

### 14-5. 재배포 (수동) — 순서 주의

결제 노드는 CI 가 자동 배포하지 않습니다(후속 작업). `deploy-dev` 와 별개로 `payment.yml --tags deploy` 를 실행합니다.

| 배포 내용 | 순서 |
|---|---|
| 결제 쪽 계약 변경 (payment.proto, SQS 메시지 형식, 결제 마이그레이션 추가) | ① `PAYMENT_IMAGE_TAG=<새 sha> ... --tags deploy` 로 결제 노드 먼저 → ② `deploy-dev` |
| 그 외 | ① `deploy-dev` → ② `payment.yml --tags deploy` (gitops 태그를 그대로 따라감) |

> 클러스터와 결제 노드의 커밋이 어긋나면 gRPC / SQS 메시지 호환 문제가 생길 수 있습니다. `payment.yml` 출력의 "이미지 태그" 와 gitops `global.imageTag` 가 같은지 확인하세요.

### 14-6. ElasticMQ (dev 용 SQS)

- 결제 결과 이벤트: payment-service 가 `payment_outbox` 미발행 행을 `payment-result.fifo` 로 보내고, booking-service 가 받아 `payment_result_inbox` 에 기록합니다 (`MessageGroupId` = reservation_id, `MessageDeduplicationId` = outbox `event_id`).
- 5회 수신 후에도 처리되지 않은 메시지는 `payment-result-dlq.fifo` 로 갑니다. 큐 이름 · 횟수 · visibility timeout 은 `group_vars/payment.yml` 에서 조정합니다.
- 큐 URL 은 `node-address` 를 결제 노드 Tailscale IP 로 고정해, `GetQueueUrl` 결과를 클러스터에서도 그대로 쓸 수 있습니다.
- ElasticMQ 는 인증이 없습니다. 접근 제어는 ACL(`tag:k8s-node → tag:payment tcp:9324`)과 ufw 로만 합니다.
- **SQS 연동 환경변수 (확정)** — 발행기(payment-service)와 소비기(booking-service)가 같은 이름을 씁니다.

  | 이름 | dev (ElasticMQ) | prod (AWS SQS) |
  |---|---|---|
  | `SQS_ENDPOINT` | `http://127.0.0.1:9324`(결제 노드) / `http://<payment ts ip>:9324`(클러스터) | 비움 → AWS SDK 기본 엔드포인트 |
  | `SQS_REGION` | `ap-northeast-2` | 실제 리전 |
  | `PAYMENT_RESULT_QUEUE_URL` | `http://<payment ts ip>:9324/000000000000/payment-result.fifo` | Terraform 43-messaging 의 큐 URL |
  | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | 더미값(`elasticmq`) — ElasticMQ 는 검증 안 함 | 넣지 않음 (IAM 역할) |

  결제 노드 쪽 값은 `group_vars/payment.yml` 의 `payment_sqs_env`, 클러스터 쪽 값은 14-4 의 booking-service env 입니다.
- 큐 · 메시지는 `/var/lib/payment-node/elasticmq` 에 저장되어 재기동해도 남습니다. **저장된 큐 설정이 설정 파일보다 우선**하므로, 이미 만들어진 큐의 visibility timeout · DLQ 횟수를 바꾸려면 (dev 한정, 남은 메시지 삭제됨) `sudo docker compose -f /opt/payment-node/compose.yml stop elasticmq && sudo rm -rf /var/lib/payment-node/elasticmq/*` 후 playbook 을 다시 실행합니다.
- 큐 상태 확인: `curl -s 'http://127.0.0.1:9324/?Action=GetQueueAttributes&QueueUrl=<큐 URL>&AttributeName.1=All'`

### 14-7. 검증

```bash
# 결제 노드
sudo docker compose -f /opt/payment-node/compose.yml ps    # payment-mariadb, elasticmq, payment-service 모두 healthy
sudo ufw status                                            # tailscale0 의 3004, 9324 만 허용
curl -s 'http://127.0.0.1:9324/?Action=ListQueues'         # payment-result.fifo, payment-result-dlq.fifo
nc -zv <control plane Tailscale IP> 30303                  # booking-service NodePort (14-4 반영 후)

# k8s 노드 (Tailnet 경유)
nc -zv <결제 노드 Tailscale IP> 3004
nc -zv <결제 노드 Tailscale IP> 9324
nc -zv <결제 노드 Tailscale IP> 3306                        # 실패해야 정상 (결제 DB 는 loopback 전용)
```

- 적용된 스키마는 `payment.yml` 마지막 출력(`schema V<n>`) 또는 `docker exec payment-mariadb mariadb --defaults-extra-file=/etc/mysql/ansible/app.cnf -e "SELECT version, description FROM flyway_schema_history"` 로 확인합니다.
- 다시 실행하면 거의 모든 task 가 `ok` (changed=0 에 가까움) 로 끝나야 합니다.

### 14-8. 트러블슈팅

- **gitops clone 실패**: Deploy Token 에 `read_repository` 가 없거나 만료된 경우 → `.secrets/payment-node.env` 의 `PAYMENT_DEPLOY_TOKEN` 을 비우고 `gitlab.yml --tags bootstrap` 재실행. timeout 이면 ACL `tag:payment → tag:gitlab tcp:443`.
- **이미지 pull 실패**: 401 이면 Deploy Token, `manifest unknown` 이면 해당 태그가 아직 승격(`push` job) 전인지 확인. timeout 이면 ACL `tag:payment → tag:gitlab tcp:5050`.
- **Flyway 실패 (validate)**: 이미 적용된 SQL 파일이 바뀐 경우입니다. 파일을 되돌리고 새 버전(`V<n+1>__...sql`)으로 추가합니다. payment-service 는 이전 버전으로 계속 동작합니다.
- **payment-service 가 healthy 가 안 됨**: playbook 이 마지막 로그 40줄을 출력합니다. `docker logs payment-service` 로 DB 접속 / 환경변수 누락을 확인합니다.
- **booking-service 호출 timeout**: gitops 에 `booking-service.nodePort` 가 반영됐는지(`kubectl -n backend get svc booking-service` 가 `NodePort`), ACL `tag:payment → tag:k8s-node tcp:30303` 을 확인합니다.
