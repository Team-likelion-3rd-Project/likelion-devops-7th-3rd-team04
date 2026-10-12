# infra/ansible — Tailscale 기반 kubeadm 클러스터 구성

팀원들이 **각자의 로컬 PC에서 띄운 VM**을 Tailscale Tailnet으로 묶어 하나의 kubeadm 클러스터를 만듭니다.

| Playbook | 대상 | 하는 일 |
|---|---|---|
| `control-plane.yml` | `[control_plane]` (1대) | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm init` → Calico(VXLAN) 설치 → worker용 `join.env` 생성 |
| `worker-join.yml` | `[workers]` | Tailscale 등록 → containerd/kubeadm 설치 → `kubeadm join` |

- OS: Ubuntu 22.04 / Kubernetes v1.33 / containerd / Calico v3.30 (tigera-operator)
- Pod CIDR `10.0.0.0/16`, Service CIDR `10.96.0.0/12`
- 모든 노드는 **Tailscale IP(100.x)** 를 node IP로 사용하며, Tailscale 태그는 `tag:k8s-node` 하나로 통일합니다.

> **비밀값은 절대 커밋하지 않습니다.** OAuth secret, join token, CA hash, API endpoint는 모두 `.env`/`.secrets/`(gitignore 대상)에서 환경변수로만 주입됩니다.

```
infra/ansible/
├── ansible.cfg
├── .env.example               # 환경변수 이름 (값 없음)
├── control-plane.yml
├── worker-join.yml
├── inventory/
│   ├── hosts.example.ini      # → hosts.ini 로 복사 (gitignore)
│   └── group_vars/all.yml     # 버전·CIDR 고정값, 환경변수 매핑
├── roles/                     # preflight, common, containerd, tailscale, kubernetes,
│                              # control_plane, calico, join_info, worker_join
└── .secrets/                  # (자동 생성, gitignore) join.env, admin.conf
```

---

## 1. Tailscale 관리자 콘솔 작업 (Tailnet 관리자 1회)

### 1-1. Access controls — 태그와 접근 규칙

[Admin console → Access controls](https://login.tailscale.com/admin/acls) 의 정책 파일에 아래 내용을 **병합**합니다. (기존 `grants`/`acls` 가 있으면 지우지 말고 항목만 추가)

```jsonc
{
  "tagOwners": {
    // OAuth client 가 이 태그로 디바이스를 등록할 수 있게 함
    "tag:k8s-node": ["autogroup:admin"]
  },
  "grants": [
    // k8s 노드끼리 전체 허용 (6443 API, 10250 kubelet, 4789/udp VXLAN, 5473 Typha 등)
    { "src": ["tag:k8s-node"], "dst": ["tag:k8s-node"], "ip": ["*"] },
    // 팀원 PC → 노드 : SSH, kubectl
    { "src": ["autogroup:member"], "dst": ["tag:k8s-node"], "ip": ["tcp:22", "tcp:6443"] }
  ]
}
```

### 1-2. OAuth client 생성

1. [Admin console → Settings → Trust credentials (OAuth clients)](https://login.tailscale.com/admin/settings/trust-credentials) → **새 credential (OAuth)** 생성
2. Scope: **Keys → Auth Keys : Write**
3. Tags: **`tag:k8s-node`**
4. 생성 직후 표시되는 **Client secret (`tskey-client-...`)** 을 복사 — 다시 볼 수 없습니다.
5. 팀 비밀 채널(1Password, 개인 DM 등)로만 공유합니다. 커밋/이슈/Slack 공개 채널 금지.

> Playbook은 이 secret을 `tailscale up --auth-key=<secret>?ephemeral=false&preauthorized=true --advertise-tags=tag:k8s-node` 형태로 직접 사용합니다. 태그가 붙은 디바이스는 사용자 소유가 아니며 key expiry도 기본 비활성입니다.

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
