# RAG 챗봇 호텔 예약 웹서비스: (RAG Chatbot-Powered Hotel Booking Web Service)

> **협업이 처음이신가요?** 이슈 생성부터 PR 머지까지 전 과정은 [협업 가이드](./docs/GUIDE.md)를 먼저 읽어주세요.

![Team](https://img.shields.io/badge/Team-team--04-151515?style=for-the-badge)
<!-- 사용 기술만 남기고 나머지는 삭제 -->
![Git](https://img.shields.io/badge/Git-151515?style=for-the-badge&logo=git&logoColor=F05032)
![Jira](https://img.shields.io/badge/Jira-151515?style=for-the-badge&logo=jira&logoColor=0052CC)
![Slack](https://img.shields.io/badge/Slack-151515?style=for-the-badge&logo=slack&logoColor=4A154B)

![TypeScript](https://img.shields.io/badge/TypeScript-151515?style=for-the-badge&logo=typescript&logoColor=3178C6)
![React](https://img.shields.io/badge/React-151515?style=for-the-badge&logo=react&logoColor=61DAFB)
![NestJS](https://img.shields.io/badge/NestJS-151515?style=for-the-badge&logo=nestjs&logoColor=E0234E)

![MariaDB](https://img.shields.io/badge/MariaDB-151515?style=for-the-badge&logo=mariadb&logoColor=003545)
![Valkey](https://img.shields.io/badge/Valkey-151515?style=for-the-badge)

![Docker](https://img.shields.io/badge/Docker-151515?style=for-the-badge&logo=docker&logoColor=2496ED)
![Kubernetes](https://img.shields.io/badge/Kubernetes-151515?style=for-the-badge&logo=kubernetes&logoColor=326CE5)
![Helm](https://img.shields.io/badge/Helm-151515?style=for-the-badge&logo=helm&logoColor=0F1689)
![ArgoCD](https://img.shields.io/badge/Argo_CD-151515?style=for-the-badge&logo=argo&logoColor=EF7B4D)
![Terraform](https://img.shields.io/badge/Terraform-151515?style=for-the-badge&logo=terraform&logoColor=844FBA)

![AWS](https://img.shields.io/badge/AWS-151515?style=for-the-badge&logo=amazonwebservices&logoColor=FF9900)

> **RAG 챗봇을 활용하여 손쉽게 호텔 정보 습득 및 호텔 예약이 가능한 웹 서비스**

본 서비스는 일반 투숙 고객에게 직관적인 객실 탐색과 실시간 예약·결제는 물론, 24시간 맞춤형 상담을 지원하는 AI 챗봇 기능을 제공하는 클라우드 네이티브 호텔 예약 플랫폼입니다. 호텔 관리자에게는 객실 가용 상태, 부대시설 요금, 고객 문의 내역과 결제 데이터를 한눈에 통합 제어할 수 있는 효율적인 운영 환경을 지원합니다.

인프라는 개발환경은 온프레미스, 운영환경은 AWS 클라우드로 분리한 하이브리드 클라우드 구조로 구성했습니다. 온프레미스에서는 VM 기반 kubeadm 멀티노드 Kubernetes 클러스터와 CI/CD 파이프라인으로 기능을 빠르게 개발·검증하고, 검증을 마친 서비스는 Terraform으로 코드화한 AWS 운영환경(EKS)에 배포합니다. 두 환경 모두 Docker 컨테이너와 Kubernetes를 기반으로 동일한 배포 방식을 사용해 개발에서 운영까지 일관된 흐름을 유지합니다. 이러한 MSA 및 고가용성 클라우드 인프라를 바탕으로 대규모 트래픽 상황에서도 오버부킹 없는 정확한 예약 처리와 높은 가용성을 목표로 설계되었습니다.

- **문서 최종 정리일:** `2026-11-09`

---

## 팀 구성

| 이름 | 역할 | 담당 | GitHub |
|------|------|------|--------|
| 김태균 | 팀장 / OnPremises | 개발환경 온프레미스 인프라 구성 / AI | [@rbsxo135](https://github.com/rbsxo135) |
| 장세훈 | Cloud | 운영환경 클라우드 인프라 구성 | [@wkdtpgns5016](https://github.com/wkdtpgns5016) |
| 김좌형 | Backend | 호텔 예약 시스템 | [@kimjhn4188-ctrl](https://github.com/kimjhn4188-ctrl) |
| 주병호 | Frontend · DB | 호텔 예약 시스템 화면 구성 및 UI/UX, DB 설계 · 마이그레이션 | [@jack7051105](https://github.com/jack7051105) |

---

## Core Design

> 이 프로젝트가 **의도적으로 선택한 원칙**을 3~6개 적습니다. 기능 나열이 아니라 설계 판단을 씁니다.

- **Github/Jira/Slack 협업 워크플로우 자동화** — GitHub Actions를 통해 Jira 티켓 상태 자동 변경 및 PR/Merge 이벤트 슬랙 알림 연동
- **MSA 설계** — 도메인별 마이크로서비스 분리를 통해 독립적 배포 및 유연한 파드 단위 스케일 아웃 지원
- **RAG 기반 챗봇** — n8n 워크플로와 벡터 검색(S3 Vectors) · Vertex AI로 호텔 정보에 근거한 답변을 제공하고, 대화로 예약 · 결제 · 취소까지 진행
- **선언적 IaC & GitOps 자동화** — Terraform 기반 인프라 코드화 및 GitHub Actions + ArgoCD를 통한 배포 자동화 및 무중단 운영 체계 구축
- **EKS Pod Identity 기반 최소 권한 통제** — 노드가 아닌 파드(Pod) 단위로 전용 IAM 역할을 바인딩하여 클라우드 보안 위협 최소화

---

## Architecture

전체 구성도와 환경별 상세는 [Wiki > System Architecture](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/wiki/System-Architecture)를 참고하세요.

| 영역 | 기술 |
|------|------|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | NestJS, TypeORM, gRPC, Swagger |
| Database | MariaDB, Valkey, MinIO(S3 호환), DynamoDB |
| Infra | 온프레미스 kubeadm(Tailscale) / AWS (VPC, EKS, ECR, RDS, ElastiCache(Valkey), SQS, S3, CloudFront, WAF, CloudWatch) |
| CI/CD | GitHub Actions, GitLab CI, ArgoCD, Helm |
| 인증 | JWT, nestjs/passport, 카카오 로그인 |
| AI | n8n, Vertex AI(Gemini) · Ollama, S3 Vectors |

---

## 주요 기능

| 기능 | 설명 | 로그인 필요 |
|------|------|------------|
| 호텔/객실 정보 조회 | 웹 페이지에서 호텔과 객실의 상세 정보를 조회할 수 있습니다. | X |
| 로그인 기능 | 고객/관리자가 각각의 전용 화면에 로그인할 수 있습니다. | X |
| 로그아웃 기능 | 사용자 및 관리자 세션을 안전하게 종료합니다. | O |
| 예약 기능 | 고객이 원하는 날짜와 객실을 선택하여 예약을 생성합니다. | O |
| 결제 기능 | 토스페이먼츠 결제위젯(테스트 키)으로 결제 · 환불하고, 로컬은 모의 결제(MOCK)로 대체합니다. | O |
| 카카오 로그인 | 카카오 계정으로 로그인 · 가입합니다. | X |
| 공지사항 | 전체 공지와 지점별 공지를 조회합니다. | X |
| 호텔 정보 관리 (Admin) | 관리자가 호텔 및 객실 정보를 추가, 수정, 삭제(CRUD)합니다. | O |
| 예약 · 호실 관리 (Admin) | 예약 목록 · 대리 예약 · 직원 취소 · 투숙 연장, 호실 배정, 공지 관리. 본사 · 지점 관리자 · 직원 권한을 나눕니다. | O |
| AI 챗봇 질의응답 | 챗봇에게 객실 사양, 편의시설, 예약 가능 여부를 대화형으로 질문합니다. | X |

주요 화면: 메인 / 목록 / 상세 / 마이페이지 — 자세한 구성은 Wiki > UI Screens 참고.
API 상세 경로와 요청/응답 구조는 Wiki > API Specification 을 따릅니다.

---

## Documentation

상세 설계·회의 기록은 **[GitHub Wiki](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/wiki)** 에서 관리합니다.

| 카테고리 | 문서 |
|----------|------|
| **Start Here** | 기획 배경 · User Flows · UI Screens |
| **Architecture** | System Architecture · ERD · API Specification |
| **Operations** | 배포 가이드 · 회의록 · 트러블슈팅 |

---

## 범위 경계

> 심사에서 가장 신뢰를 얻는 항목입니다. **되는 것과 안 되는 것을 정확히** 씁니다.

**현재 제공:**

- 호텔 페이지: 유저 로그인/로그아웃
- 호텔 페이지: 호텔 및 객실 실시간 조회
- 관리자 페이지: 관리자 로그인/로그아웃
- 호텔 페이지: 예약 기능
- 호텔 페이지: 챗봇 기능
- 관리자 페이지: 호텔 및 객실 정보 추가, 수정, 삭제
- 챗봇: F&Q, 간단한 질문 

**현재 미제공:**
- 호텔 페이지: 실제 결제 → 토스 테스트 결제(실제 돈이 나가지 않음)와 로컬 모의 결제로 대체
- 챗봇: 복잡한 질문처리

**배포 단계:** `dev` → `prod`

---

## 보안과 개인정보 경계

이 저장소는 공개 저장소입니다. 다음 정보를 절대 포함하지 않습니다.

- 인증·클라우드 비밀값, `.env` 실제 값, 인증서·키 파일
- 실제 사용자 개인정보, 운영 DB 계정 정보
- 내부 인프라 식별자 및 서버 직접 접근 URL

비밀값이 실수로 커밋되면 GitHub이 push를 차단합니다. 이미 커밋된 경우 **즉시 해당 키를 폐기하고 재발급**하세요. 커밋을 되돌리는 것만으로는 이력에 남습니다.

---

## 로컬 실행

> 환경별 기동 절차: **로컬 실행**(아래, 개발자 PC) · [온프레미스 dev](#온프레미스-dev-기동-절차) · [AWS prod](#aws-prod-기동-절차)

**사전 요구사항:** Docker(Compose v2), Node 24.19.0 (서비스 이미지는 Node 20으로 빌드)

> Windows는 WSL에서 실행합니다. 저장소를 Windows 폴더(`/mnt/c/...`)에 두면 Vite가 파일 변경을 감지하지 못해, 코드를 고친 뒤 개발 서버를 다시 시작해야 반영됩니다 ([#396](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/issues/396)).

### 1. Backend

```bash
cp backend/.env.example backend/.env    # git 미추적. 기본값 그대로 로컬 실행 가능
cd backend
docker compose --profile local-infra up -d --build
docker compose --profile local-infra ps   # api-gateway 등이 healthy가 될 때까지 확인
```

- `--profile local-infra`가 MariaDB · Valkey · MinIO · ElasticMQ(SQS) · DynamoDB Local을 함께 띄우고, DB 마이그레이션(Flyway)과 시드(호텔 · 객실 · 관리자 계정)를 실행합니다.
- 처음에는 이미지 빌드로 몇 분 걸립니다. 확인: `http://localhost:3000/api-docs` (Swagger)
- 관리자 로그인: `backend/.env`의 `SEED_ADMIN_EMAIL` · `SEED_ADMIN_PASSWORD` (`.env.example` 기본값은 로컬 전용). 고객 계정은 화면에서 회원가입합니다.
- 결제는 기본 `PAYMENT_PROVIDER=MOCK`(pg-mock으로 승인)입니다. 토스 테스트 결제창은 `TOSS_SECRET_KEY`와 프론트 `VITE_PAYMENT_MODE=TOSS` · `VITE_TOSS_CLIENT_KEY`가 필요합니다(키는 팀 DM으로 전달).
- 카카오 로그인은 `KAKAO_*` 값이 있을 때만 동작합니다(선택).

**끄고 다시 켜기**

```bash
docker compose --profile local-infra stop     # 데이터 유지
docker compose --profile local-infra start
```

> ⚠️ MariaDB에 볼륨이 없어 `docker compose down`이나 `.env` 수정 후 컨테이너를 다시 만들면 **로컬 DB 데이터가 사라집니다** ([#397](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/issues/397)). 코드만 바꿨다면 `up -d --build --no-deps <서비스>`로 그 서비스만 다시 올립니다.

### 2. 챗봇 (langchain_rag, 선택)

```bash
cp langchain_rag/llm-service/.env.example langchain_rag/llm-service/.env
cd langchain_rag
docker compose up -d --build
```

- n8n(`http://localhost:5678`) · llm-service(`http://localhost:8001`) · Ollama(`http://localhost:11434`)가 뜹니다. backend의 chat-bot-service가 `N8N_WEBHOOK_URL`(`host.docker.internal:5678`)로 n8n을 호출합니다.
- 기본 LLM은 로컬 Ollama(`LLM_PROVIDER=ollama`)라 첫 빌드 때 모델을 내려받아 오래 걸리고, CPU에서는 답변이 느립니다. Vertex AI를 쓰려면 `LLM_PROVIDER=vertex`와 GCP 서비스 계정 키가 필요합니다.
- RAG 문서 검색은 S3 Vectors를 쓰므로 AWS 자격 증명이 없으면 근거 문서 없이 답변합니다.

### 3. Frontend

```bash
cp frontend/.env.example frontend/.env.development.local   # git 미추적
cd frontend
npm install
npm run dev
```

`.env.development.local`에서 API 연결 방식을 **하나만** 남깁니다. 두 방식 모두 Vite 개발 서버가 `/api`를 대신 전달해서, 화면과 API가 같은 출처가 되어 Refresh Token 쿠키와 CORS 문제가 없습니다.

| 방식 | 설정 |
|---|---|
| 내 PC backend (1번) | `VITE_DEV_API_PROXY=http://localhost:3000` |
| 온프레미스 dev 클러스터 (팀원 · Tailscale 연결 필요) | `VITE_DEV_API_PROXY=http://k8s-control-plane.<tailnet>.ts.net:30080` (이름은 `tailscale status`로 확인) |

결제 방식은 같은 파일의 `VITE_PAYMENT_MODE`(기본 `MOCK`)로 backend와 맞춥니다.

### 접속 주소

| 대상 | 주소 |
|---|---|
| 고객 화면 / 관리자 화면 | `http://localhost:5173` / `http://localhost:5173/admin` |
| api-gateway (HTTP, Swagger `/api-docs`) | `http://localhost:3000` |
| pg-mock-service (HTTP, 모의 결제) | `http://localhost:3007` |
| user · hotel · booking · payment · chat-bot · auth (gRPC) | `localhost:3001` · `3002` · `3003` · `3004` · `3005` · `3006` |
| MariaDB · Valkey | `localhost:3306` · `localhost:6379` |
| MinIO (S3 API · 관리 콘솔) | `http://localhost:9000` · `http://localhost:9001` |

env 템플릿: `backend/.env.example`, `frontend/.env.example`, `langchain_rag/llm-service/.env.example`

### 검증

```bash
# backend: NestJS monorepo라 앱 이름을 지정해서 빌드 (각 서비스 Dockerfile과 같은 순서)
cd backend
npm ci
npm run build common
for app in api-gateway auth-service booking-service chat-bot-service hotel-service payment-service pg-mock-service user-service; do npm run build $app; done
npm test

# frontend
cd ../frontend
npm run lint
npm run build
```

예약 · 결제 핵심 흐름 E2E(Playwright)는 [e2e/README.md](./e2e/README.md)를 참고하세요.

## 온프레미스 dev 기동 절차

팀원 PC의 VM을 Tailscale로 묶은 kubeadm 클러스터에 `develop`을 배포하는 개발 환경입니다. 아래는 큰 순서만 적었습니다. 값 설정 · 검증 · 트러블슈팅은 [infra/ansible/README.md](./infra/ansible/README.md)의 절 번호를 따릅니다.

**사전 준비**
- Tailscale Tailnet 가입 (ACL · OAuth client는 Tailnet 관리자가 1회 설정, 1절)
- WSL에 ansible-core, 노드용 Ubuntu 22.04 VM, SSH 키 (2절)
- `infra/ansible/.env`와 `inventory/hosts.ini` 작성 (`.env.example` · `hosts.example.ini` 복사, 비밀값은 커밋하지 않음)

**1. 클러스터 · 노드 구성 (최초 1회)**

```bash
cd infra/ansible
set -a; source .env; set +a

ansible-playbook control-plane.yml -K     # CP 담당: kubeadm init, Calico, join.env 생성 (3절)
ansible-playbook worker-join.yml -K       # 각 팀원: join.env를 받아 worker 합류 (4절)
ansible-playbook ingress.yml -K           # Traefik NodePort 30080 → api-gateway (11절)
ansible-playbook db.yml -K                # DB 노드: MariaDB · Valkey · MinIO · DynamoDB Local · OpenBao (7 · 16절)
ansible-playbook payment.yml -K           # 결제 노드: 결제 DB · ElasticMQ · payment-service (14절)
ansible-playbook gitlab.yml -K            # GitLab (8절)
ansible-playbook gitlab-runner.yml -K     # GitLab Runner (9절)
ansible-playbook k8s-cicd.yml -K          # ESO(OpenBao 연결) · backend 네임스페이스 · ArgoCD (12절)
ansible-playbook monitoring.yml -K        # 선택: Prometheus · Grafana (17절)
```

**2. 배포 (develop)**
1. `develop`에 push되면 GitHub Actions가 온프레미스 GitLab으로 미러링하고, GitLab Runner가 테스트 · 이미지 빌드 · smoke test · 레지스트리 push를 **자동으로** 실행합니다.
2. 배포는 **수동 승인**(`when: manual`)입니다. 배포 일정(화 · 목)에 파이프라인의 **`deploy-dev` ▶**를 누르면 배포 상태(이미지 태그 · 차트 revision)가 gitops 레포에 커밋되고, 온프레미스 ArgoCD가 gitops 레포를 sync해서 반영합니다(Flyway 마이그레이션 → seed Job → 앱). pull 방식이라 파이프라인에는 클러스터 자격 증명이 없습니다.
3. 결제 노드는 따로 배포합니다: `ansible-playbook payment.yml -K --tags deploy` (14-5절, 순서 주의)
4. 롤백은 GitLab Run pipeline에 `ROLLBACK_TO=<배포 태그>`를 넣어 실행합니다. **DB가 그 버전의 시드 상태로 초기화**되니 팀에 먼저 알립니다 (12-5절).

**3. 확인 · 접속**
- 노드 · Pod: `kubectl --kubeconfig .secrets/admin.conf get nodes` · `get pods -n backend`, 배포 결과는 ArgoCD UI의 `backend` 앱
- 화면: 프론트는 클러스터에 배포하지 않고, 개발자 PC의 Vite로 클러스터 API에 연결합니다([로컬 실행](#로컬-실행) 3번의 온프레미스 방식).

## AWS prod 기동 절차

AWS(`us-east-1`) 운영 환경입니다. 인프라는 Terraform(Terragrunt)으로 만들고, 앱은 릴리스 PR → GitHub Actions(`release.yml`) → gitops → ArgoCD로 배포합니다. 운영 배포는 GitHub Actions가 맡고, GitLab은 운영에 배포하지 않습니다. 상세는 [infra/terraform/README.md](./infra/terraform/README.md)(인프라)와 [infra/gitops/prod/README.md](./infra/gitops/prod/README.md)(릴리스 · 배포)를 따릅니다.

**사전 준비**
- Terraform `>= 1.11`, Terragrunt `>= 1.1`, AWS CLI, gcloud (챗봇 Vertex AI 스택용)
- 자격 증명: `infra/terraform/aws-login.sh`로 `team04` 프로필에 로그인, `gcloud auth application-default login`
- **모든 명령에 `AWS_PROFILE=team04`** (빠지면 다른 계정으로 실행됨)

**1. 인프라 생성**

```bash
export AWS_PROFILE=team04 TG_PROVIDER_CACHE=1
cd infra/terraform/live/prod
terragrunt run --all plan
terragrunt run --all apply      # 스택 의존 순서대로 생성 (같은 단계는 병렬)
```

- 🔒 최초 1회 스택: `bootstrap`(terraform) · `10-global`(도메인 · 인증서 · OIDC) · `11-registry`(ECR) · `12-secrets`(비밀값, `run --all` 대상이 아니라 값을 넣고 직접 apply) · `13-frontend`(S3 · CloudFront) · `14-gcp-llm` · `15-chatbot-vectors`. 이 스택들은 destroy하지 않습니다.
- 🔁 매일 재생성 스택: 네트워크(20) → 보안(30) → 데이터 · 메시징(41 – 44) → 웹훅 · Pod 권한(50 · 51) → 결제 서버(60 · 61) → EKS · PrivateLink(71 · 72) → ALB · WAF(80) → 알람(90)
- `72-main-cluster-eks`가 EKS · 노드 그룹과 함께 **ArgoCD와 root 앱까지 설치**하고, ArgoCD가 gitops 레포 `envs/prod`를 동기화합니다. 메인 DB(RDS)는 매일 새로 만들어지므로 backend 배포 때마다 seed Job이 초기 데이터를 채웁니다.
- 클러스터 접속: `./eks-kubeconfig.sh` (재생성 후 다시 실행)

**2. 배포 (릴리스)**
1. dev에서 검증된 `develop` 커밋으로 `release/<버전>` 브랜치를 만들고, `main`으로 릴리스 PR을 올려 승인 후 merge합니다.
2. GitHub Actions `release.yml`이 바뀐 것만 반영합니다: GHCR 이미지 → ECR 복사(재빌드 없음), 프론트 운영 빌드 → S3 `releases/<SHA>/`, gitops 레포에 릴리스 PR 생성.
3. gitops 릴리스 PR을 승인 · merge하면 반영됩니다: 백엔드는 ArgoCD(Flyway · seed 포함), 결제 서버는 Parameter Store → pull agent, 프론트는 CloudFront KeyValueStore 버전 전환.
4. Slack `#deploy` 성공 알림과 https://meomulm.click 에서 확인하고, `main` merge 커밋에 버전 태그(`vX.Y.Z`)를 붙입니다.
- 롤백: 프론트는 gitops의 frontend `version`, 백엔드는 이전 릴리스 값으로 되돌리는 gitops PR (자동 롤백 없음)

**3. 내리기**
- `terragrunt run --all destroy` (🔒 스택은 자동 제외). 그 전에 토스 웹훅 큐(`payment-webhook` · DLQ)가 비었는지 확인합니다.

---

## 기여 방법
- **규칙 요약** — [CONTRIBUTING.md](./CONTRIBUTING.md)
- **협업 절차 상세** — [협업 가이드](./docs/GUIDE.md)
- **워크플로우 가이드 문서** — [워크플로우 가이드](./docs/AUTOMATION.md)

## License

이 프로젝트는 [MIT License](./LICENSE) 를 따릅니다.
