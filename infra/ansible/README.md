# infra/ansible — Tailscale 기반 kubeadm 클러스터 / DB 노드 / GitLab 구성

팀원들이 **각자의 로컬 PC에서 띄운 VM**을 Tailscale Tailnet으로 묶어 하나의 kubeadm 클러스터와 DB 노드, GitLab / GitLab Runner 노드를 만듭니다.

| Playbook | 대상 | 하는 일 |
|---|---|---|
| `control-plane.yml` | `[control_plane]` (1대) | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm init` → Calico(VXLAN) 설치 → worker용 `join.env` 생성 |
| `worker-join.yml` | `[workers]` | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm join` |
| `db.yml` | `[db]` (1대) | Tailscale 등록(`tag:db`) → Docker → ufw → MariaDB + Valkey (Docker Compose) — [7절](#7-db-노드-구성-mariadb--valkey) |
| `gitlab.yml` | `[gitlab]` (1대) | Tailscale 등록(`tag:gitlab`) → Docker → ufw → GitLab CE (Docker Compose) → `tailscale serve` HTTPS → Runner 토큰 발급 — [8절](#8-gitlab-노드-구성) |
| `gitlab-runner.yml` | `[gitlab_runner]` (1대) | Tailscale 등록(`tag:gitlab-runner`) → Docker → ufw → GitLab Runner (docker executor) 등록 — [9절](#9-gitlab-runner-노드-구성) |
| `ingress.yml` | `[control_plane]` (1대) | helm 설치 → Traefik Ingress Controller (NodePort 30080) — [11절](#11-ingress-controller-traefik) |
| `k8s-cicd.yml` | `[control_plane]` (1대) | GitLab Agent(agentk) 설치 → `backend` 네임스페이스 / CI 배포 RBAC → 레지스트리 pull Secret · `backend-secrets` — [12절](#12-cicd-kas--registry--agent--파이프라인) |
| `registry-trust.yml` | `[control_plane]`, `[workers]` | containerd `certs.d` 설정 (사설 CA 를 쓸 때 레지스트리 CA 신뢰) — [12-7](#12-7-사설-ca-를-쓸-때-선택) |

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
├── ingress.yml
├── k8s-cicd.yml
├── registry-trust.yml
├── inventory/
│   ├── hosts.example.ini      # → hosts.ini 로 복사 (gitignore)
│   ├── aws.ini                # AWS 노드가 자기 자신에게 실행할 때 쓰는 inventory (12절)
│   └── group_vars/
│       ├── all.yml            # 버전·CIDR 고정값, 환경변수 매핑
│       ├── control_plane.yml  # Ingress: helm/Traefik 버전, NodePort / CI/CD: agent 버전, backend-secrets key
│       ├── db.yml             # DB 노드: 이미지 버전, 튜닝값, backend/.env 매핑
│       ├── gitlab.yml         # GitLab 노드: 이미지 버전, 포트, Runner 태그
│       ├── gitlab_runner.yml  # Runner 노드: 버전, concurrent, GitLab 접속 정보 매핑
│       └── aws_control_plane.yml  # AWS CP: Tailscale 끔, Calico MTU / 노드 IP 감지
├── filter_plugins/dotenv.py   # backend/.env 파서 (parse_dotenv)
├── roles/                     # preflight, common, containerd, tailscale, kubernetes,
│                              # control_plane, calico, join_info, worker_join,
│                              # docker, firewall, db_stack,
│                              # gitlab_stack, tailscale_serve, gitlab_runner_token, gitlab_runner,
│                              # helm, traefik,
│                              # gitlab_bootstrap, gitlab_agent, backend_namespace
└── .secrets/                  # (자동 생성, gitignore) join.env, admin.conf, gitlab-runner.env,
                               # gitlab-k8s.env, github-mirror.env
```

---

## 1. Tailscale 관리자 콘솔 작업 (Tailnet 관리자 1회)

### 1-1. Access controls — 태그와 접근 규칙

[Admin console → Access controls](https://login.tailscale.com/admin/acls) 의 정책 파일에 아래 내용을 **병합**합니다. (기존 `grants`/`acls` 가 있으면 지우지 말고 항목만 추가)

| 태그 | 대상 | Playbook |
|---|---|---|
| `tag:k8s-node` | control plane, worker | `control-plane.yml`, `worker-join.yml` |
| `tag:db` | DB 노드 (MariaDB + Valkey) | `db.yml` |
| `tag:gitlab` | GitLab 노드 | `gitlab.yml` |
| `tag:gitlab-runner` | GitLab Runner 노드 | `gitlab-runner.yml` |
| `tag:ci` | GitHub Actions runner (ephemeral, 미러링 workflow) | `.github/workflows/mirror-gitlab.yml` |

```jsonc
{
  "tagOwners": {
    // OAuth client 가 이 태그로 디바이스를 등록할 수 있게 함
    "tag:k8s-node": ["autogroup:admin"],
    "tag:db":       ["autogroup:admin"],
    "tag:gitlab":        ["autogroup:admin"],
    "tag:gitlab-runner": ["autogroup:admin"],
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
    // k8s Pod → DB. Pod 트래픽은 Calico natOutgoing 으로 노드 IP(100.x)로 SNAT 되어 도착
    { "src": ["tag:k8s-node"], "dst": ["tag:db"], "ip": ["tcp:3306", "tcp:6379"] },
    // GitLab CI 이미지 smoke test → dev DB 서버 (파이프라인 전용 database ci_<id> 만 사용, 12절)
    { "src": ["tag:gitlab-runner"], "dst": ["tag:db"], "ip": ["tcp:3306", "tcp:6379"] },
    // 팀원 PC → DB : SSH, DBeaver 등 DB 클라이언트, valkey-cli 디버깅
    { "src": ["autogroup:member"], "dst": ["tag:db"], "ip": ["tcp:22", "tcp:3306", "tcp:6379"] },

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
    { "src": ["autogroup:member"], "dst": ["tag:gitlab-runner"], "ip": ["tcp:22"] }
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

## 7. DB 노드 구성 (MariaDB + Valkey)

backend 서비스가 사용할 MariaDB와, 향후 Redis를 대체할 Valkey를 DB 전용 VM 1대에 Docker Compose로 띄웁니다.

| 서비스 | 이미지 | 포트 | 비고 |
|---|---|---|---|
| MariaDB | `mariadb:11.4.13` (LTS) | `DB_PORT` (3306) | backend `DB_*` 와 동일한 계정/DB |
| Valkey | `valkey/valkey:9.1.2` | 6379 | 기동만 — backend `REDIS_*` 연동은 추후 |

- 두 컨테이너 모두 `network_mode: host` 로 뜨고, **ufw 가 `tailscale0` 으로 들어오는 3306/6379 만 허용**합니다. (Docker 포트 publish 는 ufw 를 우회하므로 사용하지 않음)
- 데이터: `/var/lib/hotel-db/{mariadb,valkey}`, 설정·자격증명: `/opt/hotel-db` (root 전용 0700)

### 7-1. VM 사양 (k6 부하 테스트 기준)

| 구분 | vCPU | RAM | Disk | 메모리 배분 |
|---|---|---|---|---|
| **권장** | 4 | 8 GB | 60 GB SSD | InnoDB buffer pool 4 GB(메모리 50%, 자동 계산) / Valkey 1 GB / OS·Docker 나머지 |
| 최소 (기능 확인용) | 2 | 4 GB | 30 GB | buffer pool 2 GB / Valkey 512 MB (`valkey_maxmemory: 512mb` 로 낮춤) |

- 커넥션: DB를 쓰는 서비스 5개(auth/booking/hotel/payment/user) × replica 수 × TypeORM(mysql2) 기본 풀 10. replica 3이면 약 150 → `max_connections=500` 으로 여유를 둡니다.
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
| `BACKEND_ENV_FILE` (선택) | `infra/ansible/.env` | backend/.env 대신 다른 파일을 쓸 때 |

- 비밀번호에는 공백, 따옴표, 역슬래시, `$`, `#`, `` ` `` 를 쓸 수 없습니다. (설정 파일에 그대로 들어가기 때문)
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
sudo docker compose -f /opt/hotel-db/compose.yml ps        # mariadb, valkey 모두 healthy
sudo ufw status                                             # 3306/6379 는 tailscale0 에서만 허용

# k8s 노드 (Tailnet 경유)
nc -zv <DB Tailscale IP> 3306
nc -zv <DB Tailscale IP> 6379

# k8s 안에서 Pod → DB (앱과 같은 경로)
kubectl run dbtest --rm -it --image=mariadb:11.4 --restart=Never --   mariadb -h <DB Tailscale IP> -u <DB_USERNAME> -p <DB_DATABASE> -e "SELECT 1"
kubectl run vktest --rm -it --image=valkey/valkey:9.1 --restart=Never --   valkey-cli -h <DB Tailscale IP> -a <VALKEY_PASSWORD> --no-auth-warning ping   # PONG
```

- DB VM 의 사설 IP 로 3306 에 접속하면 **차단**되어야 정상입니다.
- 다시 실행하면 거의 모든 task 가 `ok` (changed=0 에 가까움) 로 끝나야 합니다.

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
- **이전 `team04-dev` Ingress**: 예전 `ingress.yml` 이 만든 `team04-dev/api-gateway` Ingress 는 `k8s-cicd.yml` 이 지우고, 네임스페이스에 다른 리소스가 없으면 네임스페이스도 지웁니다.
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
  build      : kaniko × 9 → <registry>/team04/hotel/<svc>:ci-<sha>        (develop 만 push)
  image-test : ci_<pipeline id> DB 생성 → flyway → 후보 이미지 기동 → GET /health
  push       : crane tag ci-<sha> → <sha>                                  (레이어 재업로드 없음)
  deploy-dev : (수동) gitops envs/dev/values.yaml 태그 커밋 → helm upgrade --atomic → rollout status
               └ ci_access ──▶ KAS ──▶ dev-agent(agentk, 온프레미스) ──▶ namespace backend
```

| 구성 요소 | 위치 | 관리 |
|---|---|---|
| 미러 workflow | `.github/workflows/mirror-gitlab.yml` | GitHub |
| 파이프라인 | `.gitlab-ci.yml` (레포 루트) | GitHub → 미러 |
| Helm 차트 | `backend-deploy/charts/backend` | GitHub → 미러 |
| 환경별 values · 이미지 태그 | GitLab `team04/infra/backend-gitops` 의 `envs/{dev,prod}/values.yaml` | CI deploy job 이 커밋 (초기본: `backend-deploy/gitops-seed`) |
| agent 설정 (`ci_access`) | `infra/gitlab/k8s-agents` → GitLab `team04/infra/k8s-agents` | Ansible `gitlab.yml --tags bootstrap` |
| agentk · RBAC · Secret | 온프레미스 클러스터 | Ansible `k8s-cicd.yml` |

| 결정 | 내용 |
|---|---|
| 환경 | dev = 온프레미스(`dev-agent`), prod = AWS EKS(`prod-agent`, 준비 중). 네임스페이스는 둘 다 `backend` |
| 브랜치 | develop → dev, main → prod. 테스트·빌드는 자동, **배포는 수동(`when: manual`)**, 같은 환경 배포는 `resource_group` 으로 직렬화 |
| 이미지 태그 | 커밋 SHA (`$CI_COMMIT_SHORT_SHA`). `latest` 는 차트가 렌더링을 거부 |
| 클러스터 권한 | GitLab CE(Free)에는 ci_access impersonation 이 없어 **CI 권한 = agentk ServiceAccount 권한** → 차트 기본 cluster-admin 을 끄고 `backend` 네임스페이스 Role 만 부여 |
| smoke test DB | dev DB 서버를 쓰되 database 는 파이프라인 전용(`ci_<id>`). hotel/user/auth/booking 이 `synchronize: true` 라 dev DB 에 붙으면 스키마가 바뀌기 때문 |

### 12-1. GitLab: KAS · Registry · 부트스트랩 (GitLab 담당자)

`gitlab.yml` 이 KAS 와 Container Registry(`<fqdn>:5050`)를 켜고, `gitlab_bootstrap` role 이 REST API 로 아래를 멱등하게 맞춥니다.

- 그룹 `team04`, `team04/infra` / 프로젝트 `team04/hotel`(미러), `team04/infra/k8s-agents`, `team04/infra/backend-gitops`
  - `ci_access` 를 받는 프로젝트는 agent 설정 프로젝트와 **같은 최상위 그룹**에 있어야 해서 `team04` 하나로 묶었습니다.
- agent `dev-agent` · `prod-agent` 등록과 토큰 발급, gitops 레포 초기 values 커밋(레포가 비어 있을 때만)
- 그룹 Deploy Token(`read_registry`) — 클러스터 imagePullSecret 용
- `team04/hotel` CI 변수: `GITOPS_PUSH_TOKEN`(gitops 레포 Project Access Token), `SMOKE_DB_*`, `SMOKE_REDIS_*` (모두 protected)
- 미러용 Project Access Token, `main`/`develop` 보호 브랜치(force push 허용), 레지스트리 cleanup policy(`ci-*` 후보 태그·kaniko 캐시 7일)

```bash
cd infra/ansible
set -a; source .env; set +a          # CI_SMOKE_DB_PASSWORD, DB_TS_IP 포함 (12-2)
ansible-playbook gitlab.yml -K                   # KAS/Registry 반영 (gitlab.rb 가 바뀌면 컨테이너 재생성, 수 분)
ansible-playbook gitlab.yml -K --tags bootstrap  # 부트스트랩만 다시
```

- 결과: `.secrets/gitlab-k8s.env`(agent 토큰, Deploy Token → 12-3), `.secrets/github-mirror.env`(미러 토큰 → 12-4). 커밋 금지, 팀 비밀 채널로만 공유합니다.
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
- **결제 DB**: 클러스터·메인 DB 노드와 분리된 별도 서버에 둘 예정이라 아직 없습니다. `PAYMENT_DB_*` 가 비어 있으면 Secret 에서 빠지고, gitops `envs/dev/values.yaml` 에서 `services.payment-service.enabled` 와 `migrations.payment.enabled` 를 `false` 로 둡니다(초기 seed 에 반영됨). 결제 DB 가 생기면 `backend/.env` 에 `PAYMENT_DB_*` 5개를 모두 채우고 `--tags backend_secrets` 로 Secret 을 갱신한 뒤 두 값을 `true` 로 바꿔 `deploy-dev` 를 실행합니다.
  - 이미지 smoke test(`test:image`)는 결제 DB 와 무관하게 파이프라인 전용 DB 로 payment-service 를 계속 검증합니다.
- 이전 `ingress.yml` 이 만든 `team04-dev` Ingress/네임스페이스를 정리합니다(다른 리소스가 있으면 네임스페이스는 남김).

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
- prod: EKS 스택 · prod-agent 설치 · ECR push 인증이 준비되면 CI 변수 `PROD_DEPLOY_ENABLED=true` 로 `deploy-prod` 를 켭니다. 지금은 main 에서 빌드 검증만 합니다.

### 12-6. ArgoCD 전환 메모

- Application 은 multi-source 로 만듭니다: 차트 = `team04/hotel` 의 `backend-deploy/charts/backend`, values = `team04/infra/backend-gitops` 의 `$values/envs/<env>/values.yaml`. `destination.namespace: backend`, `CreateNamespace=false`.
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
