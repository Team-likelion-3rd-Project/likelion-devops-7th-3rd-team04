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
![Redis](https://img.shields.io/badge/Redis-151515?style=for-the-badge&logo=redis&logoColor=FF4438)

![Docker](https://img.shields.io/badge/Docker-151515?style=for-the-badge&logo=docker&logoColor=2496ED)
![Kubernetes](https://img.shields.io/badge/Kubernetes-151515?style=for-the-badge&logo=kubernetes&logoColor=326CE5)
![Helm](https://img.shields.io/badge/Helm-151515?style=for-the-badge&logo=helm&logoColor=0F1689)
![ArgoCD](https://img.shields.io/badge/Argo_CD-151515?style=for-the-badge&logo=argo&logoColor=EF7B4D)
![Terraform](https://img.shields.io/badge/Terraform-151515?style=for-the-badge&logo=terraform&logoColor=844FBA)

![AWS](https://img.shields.io/badge/AWS-151515?style=for-the-badge&logo=amazonwebservices&logoColor=FF9900)

> **RAG 챗봇을 활용하여 손쉽게 호텔 정보 습득 및 호텔 예약이 가능한 웹 서비스**

본 서비스는 일반 투숙 고객에게 직관적인 객실 탐색과 실시간 예약·결제는 물론, 24시간 맞춤형 상담을 지원하는 AI 챗봇 기능을 제공하는 클라우드 네이티브 호텔 예약 플랫폼입니다. 호텔 관리자에게는 객실 가용 상태, 부대시설 요금, 고객 문의 내역과 결제 데이터를 한눈에 통합 제어할 수 있는 효율적인 운영 환경을 지원합니다.

인프라는 개발환경은 온프레미스, 운영환경은 AWS 클라우드로 분리한 하이브리드 클라우드 구조로 구성했습니다. 온프레미스에서는 VM 기반 kubeadm 멀티노드 Kubernetes 클러스터와 CI/CD 파이프라인으로 기능을 빠르게 개발·검증하고, 검증을 마친 서비스는 Terraform으로 코드화한 AWS 운영환경(EKS)에 배포합니다. 두 환경 모두 Docker 컨테이너와 Kubernetes를 기반으로 동일한 배포 방식을 사용해 개발에서 운영까지 일관된 흐름을 유지합니다. 이러한 MSA 및 고가용성 클라우드 인프라를 바탕으로 대규모 트래픽 상황에서도 오버부킹 없는 정확한 예약 처리와 높은 가용성을 목표로 설계되었습니다.

- **문서 최종 정리일:** `2026-10-07` / **구현 기준일:** `2026-08-21`

---

## 팀 구성

| 이름 | 역할 | 담당 | GitHub |
|------|------|------|--------|
| 김태균 | 팀장 / OnPremises | 개발환경 온프레미스 인프라 구성 / AI | [@rbsxo135](https://github.com/rbsxo135) |
| 장세훈 | Cloud | 운영환경 클라우드 인프라 구성 | [@wkdtpgns5016](https://github.com/wkdtpgns5016) |
| 김좌형 | Backend | 호텔 예약 시스템 | [@kimjhn4188-ctrl](https://github.com/kimjhn4188-ctrl) |
| 주병호 | Frontend | 호텔 예약 시스템 화면 구성 및 UI/UX | [@jack7051105](https://github.com/jack7051105) |

---

## Core Design

> 이 프로젝트가 **의도적으로 선택한 원칙**을 3~6개 적습니다. 기능 나열이 아니라 설계 판단을 씁니다.

- **Github/Jira/Slack 협업 워크플로우 자동화** — GitHub Actions를 통해 Jira 티켓 상태 자동 변경 및 PR/Merge 이벤트 슬랙 알림 연동
- **MSA 설계** — 도메인별 마이크로서비스 분리를 통해 독립적 배포 및 유연한 파드 단위 스케일 아웃 지원
- **RAG 기반 챗봇** — Vector DB와 Graph DB(Neptune)를 결합한 지식 그래프 RAG로 환각(Hallucination) 없는 정확한 호텔 정보 제공
- **선언적 IaC & GitOps 자동화** — Terraform 기반 인프라 코드화 및 GitHub Actions + ArgoCD를 통한 배포 자동화 및 무중단 운영 체계 구축
- **EKS Pod Identity 기반 최소 권한 통제** — 노드가 아닌 파드(Pod) 단위로 전용 IAM 역할을 바인딩하여 클라우드 보안 위협 최소화

---

## Architecture

![아키텍처]()

```

```

| 영역 | 기술 |
|------|------|
| Frontend | React, TypeScript, Vite, Tailwind |
| Backend | NestJS, TypeORM, gRPC, Swagger |
| Database | MariaDB, Redis |
| Infra | AWS (VPC, ECR, EKS, EC2, S3, ElastiCache, CloudFront, CloudWatch) |
| CI/CD | GitLab, ArgoCD |
| 인증 | JWT, nestjs/passport |

---

## 주요 기능

| 기능 | 설명 | 로그인 필요 |
|------|------|------------|
| 호텔/객실 정보 조회 | 웹 페이지에서 호텔과 객실의 상세 정보를 조회할 수 있습니다. | X |
| 로그인 기능 | 고객/관리자가 각각의 전용 화면에 로그인할 수 있습니다. | X |
| 로그아웃 기능 | 사용자 및 관리자 세션을 안전하게 종료합니다. | O |
| 예약 기능 | 고객이 원하는 날짜와 객실을 선택하여 예약을 생성합니다. | O |
| 결제 기능 | 예약 내역에 대한 모의 결제 프로세스를 수행합니다. | O |
| 호텔 정보 관리 (Admin) | 관리자가 호텔 및 객실 정보를 추가, 수정, 삭제(CRUD)합니다. | O |
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
- 호텔 페이지: 결제 기능 → 목업 형태로 대체
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

**사전 요구사항:** Docker, Node 24.19.0

**Backend**

```bash
cp backend/.env.example backend/.env
cp backend/scripts/Dockerfile.seed.example backend/scripts/Dockerfile.seed
cd backend
docker compose --profile local-infra up --build
```

**Lanchain RAG**
```bash
cp langchain_rag/llm-service/.env.example langchain_rag/llm-service/.env
cd langchain_rag
docker compose up --build
```

**Frontend**

```bash
cp frontend/.env.example frontend/.env
cd frontend
npm install
npm run dev
```

- backend: 
  - api-gateway : `http://localhost:3000`
  - user-service : `http://localhost:3001`
  - hotel-service : `http://localhost:3002`
  - booking-service : `http://localhost:3003`
  - payment-service : `http://localhost:3004`
  - chat-bot-service : `http://localhost:3005`
  - auth-service : `http://localhost:3006`
  - pg-mock-service : `http://localhost:3007`
- frontend: 
  - 고객 전용 페이지 : `http://localhost:5173`, 
  - 관리자 전용 페이지 : `http://localhost:5173/admin`
- env 템플릿: 
  - `backend/.env.example`, 
  - `frontend/.env.example`
  - `langchain_rag/llm-service/.env.example`

**검증**

```bash
cd backend && npm run build
cd frontend && npm run build
````

---

## 기여 방법
- **규칙 요약** — [CONTRIBUTING.md](./CONTRIBUTING.md)
- **실행 방법 상세** — [협업 가이드](./docs/GUIDE.md)
- **워크플로우 가이드 문서** — [워크플로우 가이드](./docs/AUTOMATION.md)

## License

이 프로젝트는 [MIT License](./LICENSE) 를 따릅니다.
