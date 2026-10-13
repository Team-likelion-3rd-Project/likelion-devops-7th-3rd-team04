# infra/ansible — Tailscale 기반 kubeadm 클러스터 / DB 노드 / GitLab 구성

팀원들이 **각자의 로컬 PC에서 띄운 VM**을 Tailscale Tailnet으로 묶어 하나의 kubeadm 클러스터와 DB 노드, GitLab / GitLab Runner 노드를 만듭니다.

| Playbook | 대상 | 하는 일 |
|---|---|---|
| `control-plane.yml` | `[control_plane]` (1대) | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm init` → Calico(VXLAN) 설치 → worker용 `join.env` 생성 |
| `worker-join.yml` | `[workers]` | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm join` |
| `db.yml` | `[db]` (1대) | Tailscale 등록(`tag:db`) → Docker → ufw → MariaDB + Valkey (Docker Compose) — [7절](#7-db-노드-구성-mariadb--valkey) |
| `gitlab.yml` | `[gitlab]` (1대) | Tailscale 등록(`tag:gitlab`) → Docker → ufw → GitLab CE (Docker Compose) → `tailscale serve` HTTPS → Runner 토큰 발급 — [8절](#8-gitlab-노드-구성) |
| `gitlab-runner.yml` | `[gitlab_runner]` (1대) | Tailscale 등록(`tag:gitlab-runner`) → Docker → ufw → GitLab Runner (docker executor) 등록 — [9절](#9-gitlab-runner-노드-구성) |

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
├── inventory/
│   ├── hosts.example.ini      # → hosts.ini 로 복사 (gitignore)
│   └── group_vars/
│       ├── all.yml            # 버전·CIDR 고정값, 환경변수 매핑
│       ├── db.yml             # DB 노드: 이미지 버전, 튜닝값, backend/.env 매핑
│       ├── gitlab.yml         # GitLab 노드: 이미지 버전, 포트, Runner 태그
│       └── gitlab_runner.yml  # Runner 노드: 버전, concurrent, GitLab 접속 정보 매핑
├── filter_plugins/dotenv.py   # backend/.env 파서 (parse_dotenv)
├── roles/                     # preflight, common, containerd, tailscale, kubernetes,
│                              # control_plane, calico, join_info, worker_join,
│                              # docker, firewall, db_stack,
│                              # gitlab_stack, tailscale_serve, gitlab_runner_token, gitlab_runner
└── .secrets/                  # (자동 생성, gitignore) join.env, admin.conf, gitlab-runner.env
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
| `tag:ci` | GitHub Actions runner (ephemeral, 추후 미러링 workflow) | — |

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
    // 팀원 PC → DB : SSH, DBeaver 등 DB 클라이언트, valkey-cli 디버깅
    { "src": ["autogroup:member"], "dst": ["tag:db"], "ip": ["tcp:22", "tcp:3306", "tcp:6379"] },

    // ── GitLab ───────────────────────────────────────────
    // Runner → GitLab : job 수신, git clone (HTTPS), git SSH
    { "src": ["tag:gitlab-runner"], "dst": ["tag:gitlab"], "ip": ["tcp:443", "tcp:2222"] },
    // GitHub Actions runner → GitLab : 코드 미러링 push (HTTPS) — 추후 workflow 에서 사용
    { "src": ["tag:ci"], "dst": ["tag:gitlab"], "ip": ["tcp:443"] },
    // 팀원 PC → GitLab : SSH(VM 관리), 웹 UI / git (HTTPS, SSH 2222)
    { "src": ["autogroup:member"], "dst": ["tag:gitlab"], "ip": ["tcp:22", "tcp:443", "tcp:2222"] },
    // 팀원 PC → Runner : SSH(VM 관리)
    { "src": ["autogroup:member"], "dst": ["tag:gitlab-runner"], "ip": ["tcp:22"] }

    // (추후, 필요할 때만) GitLab CI 에서 마이그레이션·통합테스트를 돌릴 경우
    // { "src": ["tag:gitlab-runner"], "dst": ["tag:db"], "ip": ["tcp:3306"] }
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
| GitHub Actions 용 | `tag:ci` | (추후) GitHub Repository Secret | 지금은 생성만 — 미러링 workflow 구현 시 등록 |

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
# WSL Ubuntu
sudo apt update && sudo apt install -y ansible   # ansible-core 2.15+

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
kubectl get tigerastatus                  # calico, apiserver AVAILABLE=True
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

GitHub Actions 가 미러링한 코드로 CI(이미지 빌드/테스트 → GHCR push)를 돌릴 온프레미스 GitLab 을 GitLab 전용 VM 1대에 Docker Compose 로 띄웁니다.
이번 범위는 **GitLab / Runner VM 과 Tailscale(HTTPS) 기반까지**이며, GitHub Actions 미러링 workflow · `.gitlab-ci.yml` · GHCR 자격증명은 추후 작업입니다.

```
GitHub Actions ──(Tailscale OAuth, tag:ci)──▶ https://gitlab.<tailnet>.ts.net ◀──(tag:gitlab-runner)── GitLab Runner ──▶ GHCR
                                                  │ tailscale serve :443 (TLS 종료, 인증서 자동 갱신)
                                                  ▼
                                          127.0.0.1:8080 → GitLab CE 컨테이너 (http)
```

| 항목 | 값 |
|---|---|
| 이미지 | `gitlab/gitlab-ce:19.4.2-ce.0` (`inventory/group_vars/gitlab.yml` 의 `gitlab_image`) |
| URL | `https://<node_name>.<tailnet>.ts.net` — `tailscale serve` 가 443 에서 TLS 종료 |
| git SSH | `ssh://git@<fqdn>:2222/...` — `tailscale serve` TCP 2222 포워딩 |
| 포트 publish | `127.0.0.1:8080`, `127.0.0.1:2222` (loopback 전용, 사설 IP 로는 접근 불가) |
| ufw | SSH, 41641/udp, `tailscale0` 의 443 / 2222 만 허용 |
| 경로 | 설정 `/opt/gitlab` (0700), 데이터 `/var/lib/gitlab/{config,logs,data}` |
| 비활성 기능 | Container Registry(GHCR 사용), KAS, Pages, 내장 Prometheus, usage ping, 외부 회원가입 |

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

### 9-4. 추후 작업 (이번 범위 밖)

- GitHub Actions: `tailscale/github-action` 으로 `tag:ci` OAuth client 를 사용해 Tailnet 접속 → GitLab 으로 미러 push
- GitLab 프로젝트 CI/CD 변수에 GHCR push 용 토큰(`write:packages`) 등록 → `.gitlab-ci.yml` 에서 `docker login ghcr.io`
- ArgoCD 도입 후 배포 단계 연동

---

## 10. GitLab / Runner 트러블슈팅

- **`tailscale serve` 단계에서 timeout**: HTTPS Certificates 가 꺼져 있으면 serve 가 활성화 URL 을 띄우고 멈춥니다. 1-3 을 확인한 뒤 다시 실행합니다.
- **HTTPS 응답 확인 단계 실패**: 첫 인증서 발급(Let's Encrypt)은 수십 초 걸릴 수 있습니다. VM 에서 `sudo tailscale cert <fqdn>` 로 발급 에러를 직접 확인할 수 있습니다.
- **URL 이 `gitlab-1.<tailnet>.ts.net` 처럼 바뀜**: 같은 호스트명의 기기가 이미 Tailnet 에 있으면 `-1` 이 붙습니다. Admin console 에서 이전 기기를 지우고 VM 에서 `sudo tailscale set --hostname=<node_name>` 후 `gitlab.yml` 을 재실행합니다. (external_url 이 바뀌므로 Runner 도 9-2 재실행)
- **job 의 git clone / docker push 가 중간에 멈춤**: 컨테이너 MTU(1500) 와 `tailscale0`(1280) 차이로 큰 패킷이 막히는 경우입니다. Runner 노드 `/etc/docker/daemon.json` 에 `"mtu": 1280` 을 추가하는 방향으로 대응합니다.
- **Runner 가 Offline**: Runner 노드에서 `tailscale ping <gitlab fqdn>` 과 ACL(`tag:gitlab-runner → tag:gitlab tcp:443`) 을 확인합니다.
