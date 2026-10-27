# infra/gitops/prod — 운영(AWS) 클러스터 배포 상태 원본

이 폴더는 gitops 레포 [`likelion-devops-7th-3rd-team04-gitops`](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04-gitops) 의 `envs/prod/` 와 **1:1 로 같은 구조**입니다. 운영 Main 클러스터는 ArgoCD 가 gitops 레포 `main` 을 읽어 배포합니다 (아래 "배포 (ArgoCD)").

## 원본 규칙

- **이 폴더가 원본입니다.** 값을 바꿀 때는 여기를 먼저 고치고, gitops 레포 `envs/prod/` 에 같은 내용을 반영합니다.
- 반영 방법
  - v1.0.0(2026-10-27) 전(구축 기간): 이 폴더 변경과 같은 내용으로 gitops 레포에 PR 을 직접 작성합니다.
  - 이후: 모노레포 릴리스 PR(release/<버전> → main) merge 때 GitHub Actions `release.yml` 이 gitops 레포에 PR 을 엽니다(values 복사 + 바뀐 컴포넌트의 이미지 태그 · chart revision · 프론트 version). 사람이 gitops 레포에 직접 PR 을 여는 것은 비상 경로뿐입니다.
- gitops 레포에만 있는 값을 만들지 않습니다. 두 곳이 다르면 이 폴더 기준으로 맞춥니다.
- public 레포로 그대로 복사되므로 **비밀값을 넣지 않습니다** (AWS Secrets Manager → External Secrets).
- 아직 옮기지 않은 `payment`(결제 서버 이미지 태그, 앱 정의 아님)는 gitops 레포 쪽이 기준입니다 (결제 단계에서 이관).
- `frontend`(프론트 버전 · 빌드 설정)도 앱 정의가 아닙니다. ArgoCD 는 읽지 않고, merge 후 gitops `sync-frontend-version` workflow 가 CloudFront KeyValueStore 에 씁니다 (아래 "릴리스").

```
infra/gitops/prod/          (= gitops 레포 envs/prod/)
├── Chart.yaml · values.yaml · templates/ · files/   root 앱 차트 (앱 정의 → Application, 배포 결과 알림)
├── traefik/               chart.yaml · values.yaml          10  Ingress Controller (워커 NodePort 30080)
├── cert-manager/          chart.yaml · values.yaml          15  webhook TLS 인증서 발급 · caBundle 주입
├── pod-identity-webhook/  chart.yaml · values.yaml          20  IRSA 주입 (ns/SA → Role 매핑)
├── whoami/                chart.yaml · values.yaml · chart/ 20  수직 경로 검증용 테스트 백엔드 (/whoami)
├── fluent-bit/            chart.yaml · values.yaml          25  파드 로그 수집 → CloudWatch Logs · 로그 버킷 app-logs/main-cluster/
├── external-secrets/      chart.yaml · values.yaml          30  External Secrets Operator
├── cluster-secret-store/  chart.yaml · chart/               40  ClusterSecretStore aws-secrets-manager
├── backend-secrets/       chart.yaml · chart/               45  backend Secret(ExternalSecret) · RDS CA ConfigMap
├── backend/               chart.yaml · values.yaml          50  backend (모노레포 backend-deploy/charts/backend, 커밋 SHA 고정)
└── frontend/              values.yaml                       —   프론트 version(main SHA) · 빌드 설정 (앱 정의 아님, Terraform 13-frontend)
```

## IRSA · 비밀값

kubeadm 클러스터라 EKS 의 IRSA 를 직접 구성했습니다.

```
Terraform 10-global  OIDC 버킷(발급자 문서) · IAM OIDC 공급자
Ansible (CP-a init)  kube-apiserver --service-account-issuer = OIDC 버킷 URL, keys.json(SA 서명 공개키) 업로드
Terraform 70         IRSA Role (irsa.tf, 신뢰 정책 sub · aud StringEquals)
pod-identity-webhook ns/SA → Role 매핑(values.yaml) 의 파드에 AWS_ROLE_ARN · 웹 ID 토큰 주입
```

- **IRSA 를 쓰는 앱을 추가할 때**: Terraform 70 `irsa.tf` 의 `irsa_roles` 에 Role(ns · SA) 을, `pod-identity-webhook/values.yaml` 에 같은 ns/SA 매핑을 추가합니다. SA 에 `eks.amazonaws.com/role-arn` annotation 은 달지 않습니다 (ARN 에 계정 ID 가 들어감).
- **비밀값**: 앱은 `ExternalSecret` 에서 `ClusterSecretStore` `aws-secrets-manager` 를 참조해 Secrets Manager 값(`team04-hotel/prod/*`)을 받습니다. 읽을 수 있는 Secret 은 ESO Role 정책(70 `irsa.tf`)과 Secret 리소스 정책(41-main-data)이 제한합니다.
- **backend Secret**: `backend-secrets` 앱이 Secret `backend-secrets` 를 만듭니다 (`chart/values.yaml` 의 `data` = Secret key ← Secrets Manager 이름 · 속성). backend 차트의 Flyway hook Job 은 차트의 일반 리소스보다 먼저 돌기 때문에 Secret 을 backend 릴리스 밖에 둡니다. 서비스가 새 `secretEnv` 를 쓰면 여기와 Terraform 41-main-data Secret 에 같이 추가합니다.
- **backend IRSA**: backend 차트가 서비스마다 같은 이름의 ServiceAccount 를 만듭니다 (`serviceAccounts.create: true`). 매핑은 `backend/<서비스 이름>` 으로 추가합니다.
- **시드 관리자 계정**: `backend-secrets` 앱이 별도 ExternalSecret 으로 Secret `seed-admin` 을 만듭니다 (`chart/values.yaml` 의 `seedAdmin`, 원본 Terraform 12-secrets `team04-hotel/prod/seed-admin`). `backend-secrets` 에 합치지 않아 이 값이 없어도 서비스 Secret 동기화는 영향을 받지 않습니다 (아래 "운영 시드").
- webhook 은 `failurePolicy: Fail` 입니다. webhook 이 준비되기 전에 만든 파드가 자격 증명 없이 남지 않고, 생성이 거부된 뒤 다시 만들어집니다. 노드 · 네트워크 · 인증서 · ArgoCD 네임스페이스는 호출하지 않습니다 (`values.yaml` namespaceSelector).

## 클러스터 값 (`clusterValues`)

public 레포에 둘 수 없는 클러스터 값(계정 ID 등)은 root 앱을 만드는 쪽이 root 의 `valuesObject.clusterValues` 로 넘깁니다 — 70(kubeadm)은 Ansible 이 CP-a 부트스트랩 때 STS 로 조회(`group_vars/aws_control_plane.yml` 의 `argocd_prod_cluster_values`). root 차트는 `chart.yaml` 에 `clusterValues: true` 인 앱에만 그 값을 Application 의 `helm.valuesObject` 로 넘깁니다 (앱 `values.yaml` 보다 우선, 모르는 키를 거부하는 차트 schema 가 있어 모든 앱에 넘기지 않음).

| 키 | 값 |
|---|---|
| `global.awsAccountId` | AWS 계정 ID (CP Role 로 STS 조회) |

values 에서는 차트가 템플릿을 지원하는 곳에 `{{ .Values.global.awsAccountId }}` 로 씁니다 (예: `pod-identity-webhook` 매핑의 `RoleARN`, backend 의 `global.imageRegistry` · `services.*.env`). gitops 레포 `validate.sh` 는 더미 값(`000000000000`)으로 렌더링합니다. 비밀값은 넣지 않습니다.

## 앱 정의 (`<앱>/chart.yaml`)

`chart.yaml` 이 있는 폴더 하나가 Helm 릴리스 하나입니다. 같은 폴더의 `values.yaml` 을 `-f` 로 넘깁니다.

| 키 | 필수 | 설명 |
|---|---|---|
| `type` | ✅ | `helm`(차트 저장소 · OCI) · `git`(다른 Git 레포의 커밋에 고정) · `local`(이 폴더 안 차트) |
| `repo` | helm · git | 차트 저장소 URL(helm, `oci://` 면 생략) · Git 레포 URL(git) |
| `chart` | helm | 차트 이름 또는 `oci://...` |
| `version` | helm | 차트 버전 (고정 버전만) |
| `path` | git · local | 차트 경로. git 은 레포 루트 기준, local 은 앱 폴더 기준(기본 `chart`) |
| `revision` | git | 커밋 SHA 40자 (브랜치 이름 금지) |
| `namespace` · `release` | ✅ | 설치할 네임스페이스(없으면 만듦) · 릴리스 이름 |
| `order` | | 적용 순서 = Application sync-wave, 작은 값부터 (기본 50). 같은 값은 함께 sync |
| `enabled` | | `false` 면 Application 을 만들지 않고 렌더링 검증에서 뺌 (기본 `true`). 이미 있던 Application 은 지워지고 리소스는 남음 |
| `clusterValues` | | `true` 면 클러스터 값(위)을 더 넘김 (기본 `false`) |

## 배포 (ArgoCD)

설치는 Ansible `roles/argocd` 의 `tasks/aws.yml` (CP-a 부트스트랩, [Ansible README](../../ansible/README.md) 13절)이 합니다. ArgoCD 와 AppProject `bootstrap`, root 앱 `prod-apps` 를 만들고, 나머지는 모두 이 레포에서 옵니다.

```
root 앱 prod-apps (Ansible 이 생성, project bootstrap)
  source: gitops 레포 main 의 envs/prod (이 폴더의 Chart.yaml · templates/) ── helm parameter gitopsRevision = $ARGOCD_APP_REVISION
  ├─ wave -1  AppProject prod (하위 앱 전용) · 알림 SA · Role · 스크립트 · CronJob deploy-notify-watch
  ├─ wave 10  Application traefik          ┐ 앱 폴더(chart.yaml) 하나 = Application 하나
  ├─ wave 15  Application cert-manager     │ 차트 = chart.yaml(helm · git · local), values = 이 레포 <앱>/values.yaml
  ├─ ...                                   │ 이 레포 소스는 모두 root 와 같은 커밋(gitopsRevision)에 고정
  ├─ wave 50  Application backend          ┘ 앞 wave 가 Healthy(Synced + 그 커밋) 가 되어야 다음 wave
  └─ PostSync Job deploy-notify-success  → #deploy 성공
CronJob deploy-notify-watch (1분)        → root sync 가 Failed · Error 로 끝나면 #deploy 실패 (15분 시간 제한 초과 포함, sync 당 1회)
```

- **gitops 커밋 하나 = root sync 하나 = 릴리스 하나.** root 가 하위 앱의 이 레포 소스를 자기 커밋에 고정하므로, values 만 바뀐 커밋도 모든 하위 Application spec 이 바뀌어 root 가 sync 합니다. ArgoCD 는 3분마다(기본 reconciliation) 브랜치를 확인합니다.
- **하위 앱 동기화**: 자동 sync · prune · selfHeal, `ServerSideApply`, `CreateNamespace`. Helm hook 은 ArgoCD hook 으로 바뀝니다 (backend Flyway `pre-install,pre-upgrade` → PreSync, backend 를 sync 할 때마다 실행). 클러스터를 직접 고치면(drift) 되돌립니다. 실패하면 제한 없이 다시 시도합니다(10초부터 2배, 최대 3분) — CRD · webhook · Secret 이 늦게 준비되는 경우를 기다리기 위해서입니다.
- **자동 롤백은 없습니다.** selfHeal 이 Git 을 따라가므로 클러스터만 이전으로 돌리면 바로 다시 덮어씁니다. 새 이미지가 Ready 가 되지 않으면 Deployment(`maxUnavailable: 0`)가 이전 파드를 유지하고, root sync 가 15분(`argocd_prod_sync_timeout_seconds`, 첫 sync 실측 약 5분의 3배) 안에 끝나지 않으면 실패 알림이 갑니다. 복구는 수정 커밋 또는 gitops 레포에서 릴리스 PR revert 입니다 (아래 "실패했을 때"). Flyway 마이그레이션은 이전에도 되돌려지지 않았습니다.
- **Ingress 는 status 가 채워져야 Healthy 입니다.** NodePort Traefik 은 채울 주소가 없어 `traefik/values.yaml` 에서 `ingressendpoint.hostname`(API 도메인)을 쓰게 했습니다 (`publishedService` 끔). 다른 Ingress Controller 를 쓰면 같은 설정이 필요합니다.
- **앱 폴더를 지우면** root 가 Application 을 지우지만 finalizer 가 없어 리소스는 남습니다 (지우는 것은 사람이 함).
- **결과는 Slack `#deploy` 로 갑니다.** 릴리스 SHA(backend `revision`) · gitops 커밋 · 이전 커밋 · 소요 시간 · 앱(실패면 Synced · Healthy 가 아닌 앱과 사유)을 10-global 배포 토픽에 발행합니다 ([Terraform README](../../terraform/README.md) 14절). 성공은 root 의 PostSync hook Job, 실패는 1분 간격 CronJob `deploy-notify-watch` 가 보냅니다 — SyncFail hook 은 시간 제한 · 사람의 종료로 끝난 sync 에서 실행되지 않아 쓰지 않습니다 (2026-10-27 검증). 같은 sync 의 실패는 ConfigMap `deploy-notify-state` 에 기록해 한 번만 보냅니다. 클러스터 생성 후 첫 sync(매일 재생성)의 성공과 같은 커밋 재sync 의 성공은 보내지 않고, 실패는 첫 sync 여도 보냅니다. Job 은 argocd 네임스페이스라 pod-identity-webhook 대상이 아니어서 IRSA 토큰을 직접 마운트합니다 (Role `team04-hotel-deploy-notify`, 배포 토픽 발행만).
- **실패 알림은 root 시간 제한(15분) 뒤에 옵니다.** 하위 앱의 실패(apply 오류 · hook 실패 · 이미지 pull 실패)는 하위 앱이 계속 재시도하고 root 는 Healthy 를 기다리므로, root 가 시간 제한으로 끝나야 실패로 판단합니다. 시간 제한은 첫 sync 실측(약 5분, 2026-10-27)의 3배이고 다음 실측으로 다시 정합니다.
- **알림이 가지 않는 경우**: root sync 가 시작되지 않으면 실패도 없습니다 — root 차트 렌더링 실패(gitops `validate` 의 root 렌더링 단계가 merge 전에 막음), ArgoCD 설치 실패(CP `cloud-init-output.log`), GitHub 접근 실패(`k -n argocd get applications` 의 conditions). 이때 Traefik 이 뜨지 않으면 90 의 ALB Target Group unhealthy 알람이 `#alerts` 로 갑니다.
- **보안**: application-controller 는 cluster-admin 이고 하위 앱 AppProject `prod` 도 클러스터 범위 리소스를 허용합니다 (CRD · ClusterRole 설치). 읽는 레포는 이 레포(ruleset 보호)와 `chart.yaml` 의 `repo` 로 좁힙니다. root 의 AppProject `bootstrap` 은 argocd 네임스페이스의 Application · AppProject · 알림 리소스만 만들 수 있습니다. ArgoCD 는 앱 파드가 뜨지 않는 CP 에 고정하고 UI · API 는 노출하지 않습니다 (ClusterIP).

### 확인 · 운영 (CP 에 SSM 접속 후)

```bash
alias k='sudo kubectl --kubeconfig /etc/kubernetes/admin.conf'
k -n argocd get applications                                   # 앱별 SYNC · HEALTH (root prod-apps 포함)
k -n argocd get application prod-apps -o jsonpath='{.status.operationState.phase} {.status.operationState.message}{"\n"}'
k -n argocd get application backend -o jsonpath='{.status.conditions}{"\n"}'   # 앱 오류 사유
k -n argocd logs job/deploy-notify-success                     # 성공 알림 Job 로그
k -n argocd get jobs | grep deploy-notify-watch                # 실패 감시 Job (최근 1개, 로그는 logs job/<이름>)
k -n argocd get configmap deploy-notify-state -o yaml           # 마지막으로 보낸 실패 (시작 시각/커밋)
# UI: 로컬에서 SSM 포트 포워딩 후 k -n argocd port-forward svc/argocd-server 8080:80, admin 비밀번호는
k -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

| 상황 | 하는 일 |
|---|---|
| 값이 잘못되어 앱이 계속 실패 | 수정 커밋 또는 릴리스 PR revert 를 gitops 레포에 반영 (하위 앱은 계속 재시도하므로 반영되면 바로 맞춰짐) |
| root 가 `Failed` 로 끝난 뒤 하위 앱이 나중에 Healthy 가 됨 | 서비스는 정상. root 는 다음 커밋에 다시 sync 합니다 (같은 커밋을 다시 보내려면 아래) |
| 같은 커밋을 다시 sync 하고 싶음 | `k -n argocd patch application prod-apps --type merge -p '{"operation":{"initiatedBy":{"username":"admin"},"sync":{}}}'` (성공이어도 같은 커밋이라 알림은 가지 않음) |
| 차트 · 레포를 가져오지 못함 | `k -n argocd get application <앱> -o yaml` 의 conditions. 네트워크면 NAT · CP SG egress |

### 작업 브랜치로 검증

gitops 레포 작업 브랜치에 push 한 뒤, root 의 대상 브랜치를 바꿉니다. **검증이 끝나면 `main` 으로 되돌립니다** (매일 재생성 때도 Ansible `argocd_prod_branch: main` 으로 다시 만들어짐). 하위 앱은 root 가 넘기는 커밋을 따라가므로 root 만 바꾸면 됩니다.

```bash
k -n argocd patch application prod-apps --type merge -p '{"spec":{"source":{"targetRevision":"<작업 브랜치>"}}}'
k -n argocd patch application prod-apps --type merge -p '{"spec":{"source":{"targetRevision":"main"}}}'   # 복구
```

## 릴리스

```
develop ──GitLab develop 파이프라인 (온프레미스, amd64)── test · 이미지 빌드 · smoke test ──▶ GHCR team04-hotel/<서비스>:<커밋 SHA>
   │                                                                                      (프론트만 바뀐 커밋은 직전 이미지에 태그만 추가)
   ▼
release/<버전> ──릴리스 PR (merge commit, release-source check · 승인)──▶ main
(develop 커밋에서 분기, 범위 고정, merge 후 삭제)                          │ push
                                                                            ▼
                     GitHub Actions release.yml (재빌드 없음)
                       plan ─┬─ frontend-build (AWS 자격 없음) ─┐
                             └──────────────────────────────────┴─ promote ─ gitops-pr
                       바뀐 컴포넌트 판단       GHCR <서비스>:<I> → ECR <서비스>:<main SHA> (digest 동일, amd64)
                       (이전 릴리스 대비)       프론트 빌드 → S3 team04-hotel-frontend/releases/<main SHA>/
                                                gitops 레포 PR release/<main SHA>  ──validate · 승인 (사람)──▶ merge
                                                                                                          ▼
                     메인 클러스터 ArgoCD (3분)  ·  결제 서버: GitHub Actions → Parameter Store → pull agent
                     프론트: GitHub Actions → CloudFront KeyValueStore version → CloudFront Function (수 초)
```

- **검증한 이미지 = 운영 이미지**: 운영에서 다시 빌드하지 않습니다. develop 파이프라인이 smoke test 를 통과시켜 GHCR 에 올린 이미지를 그대로 ECR 로 복사하므로 운영 노드 · 결제 서버도 같은 x86_64(t3a)입니다. Tailscale · AWS Runner 를 쓰지 않습니다.
- **복사할 이미지 커밋 `I`**: GitLab develop 파이프라인은 백엔드 · 프론트 경로가 바뀐 커밋에서만 돌기 때문에, 릴리스 커밋 X(= `release/*` head)에서 first-parent 로 거슬러 올라가 그 경로를 마지막으로 바꾼 커밋이 `I` 입니다 (`infra/gitops/scripts/image-sha.sh`). promote 는 GHCR 이미지의 label revision 이 X 와 백엔드 소스가 같은지도 확인합니다.
- **컴포넌트별 릴리스**: `release-plan.sh` 가 이전 릴리스(gitops `main` 의 backend `revision` · frontend `version`)와 X 를 비교해 바뀐 것만 갱신합니다.

  | 컴포넌트 | 판단 경로 | 바뀌었을 때 |
  |---|---|---|
  | backend · payment | `backend` `backend-deploy` `langchain_rag` `.gitlab-ci.yml` | ECR 복사 12개 · n8n 미러, backend `imageTag` · `revision`, payment `imageTag` 를 main SHA 로 |
  | frontend | `frontend` `infra/gitops/prod/frontend` `infra/gitops/scripts/frontend-build.sh` | 운영 빌드 → S3 `releases/<SHA>/`, frontend `version` 을 main SHA 로 |
  | 클러스터 설정 | 이 폴더의 나머지 | 복사 후 gitops 와 다르면 PR 에 포함 (이미지 없음) |

  안 바뀐 컴포넌트는 이전 값 그대로 둡니다. 셋 다 같으면 PR 을 만들지 않습니다.

| 단계 | 누가 · 무엇으로 | 할 수 있는 것 |
|---|---|---|
| 릴리스 PR merge | 사람 (모노레포 main ruleset: 승인 · `release-source` · GitHub CI check) | main 갱신 |
| ECR 복사 · 프론트 업로드 | `release.yml` — 릴리스 Role(Terraform 10-global, 이 레포 `refs/heads/main` 실행만 assume) | `team04-hotel/*` push(ECR 저장소 정책이 다른 주체의 push 거부), 사이트 버킷 `releases/*` PutObject (운영 버전 전환 불가) |
| 프론트 빌드 | `release.yml` frontend-build — AWS 자격 · OIDC 토큰 없음 | 빌드 산출물만 다음 job 에 넘김 (npm 의존성이 Role 을 받지 못함) |
| gitops 릴리스 PR 생성 | `release.yml` gitops-pr — GitHub App(`team04-hotel-release-bot`, gitops 레포에만 설치, 자격은 12-secrets 를 릴리스 Role 로 읽음) | 브랜치 push · PR 생성까지. main merge 는 ruleset 이 막음 |
| 운영 반영 | 사람이 gitops PR 승인 · merge | 메인: ArgoCD / 결제: Parameter Store 동기화(GitHub OIDC Role, 파라미터 하나) / 프론트: KeyValueStore `version` 갱신(같은 Role, 키 하나 — S3 쓰기 불가) |

- 이미지 태그 = **main 커밋 SHA 40자**, backend `chart.yaml` 의 `revision` 과 같은 값입니다. ECR 은 IMMUTABLE 이라 같은 태그로 다시 push 할 수 없습니다.
- 릴리스 Role 에는 Parameter Store · KeyValueStore 쓰기 권한이 없습니다. 결제 서버 태그 · 프론트 버전은 gitops PR 이 승인 · merge 된 뒤에만 바뀝니다.
- 프론트 빌드 설정(`VITE_*`)은 이 폴더의 `frontend/values.yaml` `build` 입니다. 토스 클라이언트 키(`VITE_TOSS_CLIENT_KEY`)만 레포에 두지 않고 Terraform `12-secrets` 의 Parameter Store 에서 plan job 이 읽어 넘깁니다. 빌드 결과에 들어가므로 gitops 레포에서 바꿔도 반영되지 않고, 여기서 고친 뒤 새 릴리스로 냅니다.
- 프론트는 버전마다 경로(`releases/<SHA>/`)가 달라 전환 · 롤백에 재업로드 · CloudFront 무효화가 없습니다. `assets/` 는 1년 immutable, 그 외(`index.html` · `favicon.svg` 등)는 no-cache 로 올립니다.
- n8n 은 빌드하지 않고 Docker Hub `n8nio/n8n:<차트 n8n.image.tag>` 를 amd64 로 ECR 에 복사합니다 (태그가 이미 있으면 건너뜀, amd64 가 아니면 실패).
- **dry-run**: 레포 변수 `RELEASE_DRY_RUN=true` 또는 수동 실행(Run workflow)의 `dry_run` 을 켜면 같은 복사를 시험 대상(ECR `team04-hotel/release-dryrun`, S3 `dryrun/`, 1일 뒤 삭제)에만 하고 gitops PR 은 만들지 않습니다. 릴리스를 잠시 막을 때도 변수를 씁니다.
- **롤백 하한**: 운영은 v1.0.0 후 리허설 릴리스(LDP-173, 2026-10-28)부터 amd64 입니다. 그 전 릴리스의 ECR 이미지는 arm64 라 지금 노드에서 뜨지 않으므로 **리허설 릴리스 `<리허설 후 기록>` 보다 이전으로 되돌리지 않습니다** (gitops revert 도 마찬가지).

### 절차 (runbook)

1. **준비**: develop 이 dev 에 배포 · 검증된 상태인지 확인합니다. 결제 쪽 계약(payment.proto · SQS 메시지 · 결제 마이그레이션)이 바뀌었으면 결제 서버를 먼저 반영할 계획을 세웁니다.
   - **develop 파이프라인 성공 확인 (필수)**: 릴리스 브랜치로 고정할 develop 커밋에 대한 GitLab `team04/hotel` develop 파이프라인이 **passed** 인지 확인합니다 (Pipelines → 브랜치 develop → 커밋 SHA 비교). 백엔드는 `push:ghcr`(프론트만 바뀐 커밋은 `push:ghcr-reuse`)까지, 프론트는 test · build job 까지 봅니다. GitLab 결과가 GitHub commit status 로 오지 않으므로 지금은 이 확인이 사람 몫입니다. 실행 중이면 끝날 때까지 기다리고, 실패했으면 develop 에서 고친 뒤 다시 확인합니다.
   - 그 커밋에서 파이프라인이 돌지 않았으면(백엔드 · 프론트 경로 변경 없음) 이전 커밋의 이미지를 씁니다 — `sh infra/gitops/scripts/image-sha.sh <커밋>` 이 출력하는 커밋의 파이프라인을 확인합니다.
2. **릴리스 PR**: 1 에서 확인한 develop 커밋으로 `release/<버전>` 브랜치를 만들고 (`git push origin <SHA>:refs/heads/release/v1.0.0`), GitHub 에서 `release/<버전> → main` PR 을 엽니다 (제목 예: `release: v1.0.0`). 이후 develop 에 merge 되는 변경은 이번 릴리스에 들어가지 않습니다. `release-source` · GitHub CI(`Backend Build & Test` 등) check 와 승인 후 **merge commit** 으로 합치고 브랜치를 삭제합니다.
   - 릴리스 브랜치에는 직접 커밋하지 않습니다 (develop 파이프라인을 거치지 않은 커밋은 GHCR 이미지가 없음). 수정이 필요하면 develop 에 먼저 merge → develop 파이프라인 passed 확인 → 브랜치를 그 커밋으로 옮깁니다 (`git push origin <새 SHA>:refs/heads/release/<버전> --force-with-lease`).
   - `release/*` 가 아닌 브랜치(`develop` · `hotfix/*` 등) → main PR 은 `release-source` check 가 거부합니다.
3. **release.yml**: 모노레포 Actions 의 `Release` 실행이 Plan → (Frontend build) → Promote → gitops release PR 까지 끝나는지 확인합니다. Plan 요약에 바뀐 컴포넌트 · `I` 가 나옵니다.
4. **gitops PR**: gitops 레포에 `chore(prod): <바뀐 컴포넌트> → <SHA 8자>` PR 이 생깁니다. 본문의 "이전 릴리스 대비 변경" 링크로 바뀐 내용을 보고, `validate` 통과 확인 후 승인 · merge 합니다.
5. **반영 확인**
   - 메인: Slack `#deploy` 에 성공 알림(릴리스 SHA)이 오는지. 오지 않으면 CP 에서 `k -n argocd get applications` 와 `k -n backend get pods` (위 "확인 · 운영")
   - 결제: gitops 레포 Actions 의 Parameter Store 동기화 workflow 성공 → 결제 서버 pull agent 반영
   - 프론트: gitops 레포 Actions `sync-frontend-version` 성공(로그의 `갱신: <이전> → <SHA>`) → 브라우저 새로고침 후 개발자 도구 Network 에서 `index-*.js` 이름이 바뀌었는지
6. **태그**: 모노레포 main 의 merge 커밋에 버전 태그를 붙입니다 (`git tag v1.0.0 <SHA> && git push origin v1.0.0`, 리허설은 `v1.0.0-rc.1`).

### 긴급 수정 (hotfix)

`hotfix/*` → main 직접 PR 은 없습니다 (그 커밋은 develop 파이프라인을 거치지 않아 GHCR 이미지가 없음). 수정 PR 을 **develop 에 먼저 merge** → develop 파이프라인 passed 확인 → 그 커밋으로 `release/<버전>` 을 만들어 위 2 – 6 과 같이 냅니다. 그 사이 develop 에 들어간 다른 변경도 함께 나가므로, 섞이면 안 되는 변경이 있으면 merge 순서를 조정합니다.

### 리허설 당일 순서 (LDP-173, amd64 전환 첫 릴리스)

amd64 Terraform 과 amd64 이미지는 함께 바뀌어야 합니다 (arm64 노드 + amd64 이미지, 또는 그 반대는 기동 실패). 그래서 그날 재생성은 gitops PR merge 뒤에 합니다.

1. 온프레미스 GitLab `release:*` · `aws-runner:*` 제거 PR 과 이 변경이 develop 에 merge 되어 있는지 확인 (두 경로가 같이 돌면 ECR IMMUTABLE 태그 충돌)
2. ECR 의 arm64 n8n 태그를 apply 주체로 한 번 삭제 — release.yml 이 같은 태그로 amd64 를 올리도록
   `aws ecr batch-delete-image --repository-name team04-hotel/n8n --image-ids imageTag=<차트 n8n.image.tag>`
3. 위 절차 1 – 2 로 릴리스 PR merge → release.yml 성공 (GitLab main 파이프라인에 release job 이 없는지도 확인)
4. gitops PR merge
5. `terragrunt run --all apply` (amd64) → 노드 · 결제 서버 `uname -m` 이 `x86_64`, ArgoCD 10개 앱 Synced/Healthy
6. 브라우저 E2E → 위 "롤백 하한" 에 리허설 릴리스 SHA 기록

### 실패했을 때

| 상황 | 하는 일 |
|---|---|
| Promote `GHCR …:<I> 없음` | `I` 커밋의 develop 파이프라인이 `push:ghcr`(· `push:ghcr-reuse`)까지 통과했는지 확인 → 실패한 job 재시도. 파이프라인이 없거나 다시 돌릴 수 없으면 GitLab Run pipeline(develop)으로 develop 최신 커밋을 빌드하고, 릴리스 브랜치를 그 커밋으로 옮겨 새 릴리스로 냅니다 (수동 실행은 develop 최신 커밋만 빌드) |
| Promote `백엔드 소스가 다름` | GHCR 태그가 다른 커밋 빌드를 가리킴. develop 파이프라인 이력 확인 후 위와 같이 다시 빌드 |
| Promote `n8n:<ver> 이 amd64 가 아님` | 오류에 나온 `batch-delete-image` 를 apply 주체로 실행 → 재실행 |
| 일부 job 실패 · 재시도 | Actions 에서 Re-run failed jobs, 또는 Run workflow(main, `dry_run` 끔). 이미 ECR 에 같은 digest 가 있으면 건너뛰고, 같은 SHA 의 gitops PR 이 열려 있으면 만들지 않고 끝납니다 |
| Frontend build 실패 | 로그 확인 (토스 클라이언트 키 Parameter 미등록이면 `12-secrets` 에 `TOSS_CLIENT_KEY` 등록) → 재실행. gitops PR 은 프론트 업로드가 끝나야 만들어집니다 |
| 운영에서 문제 발견 | gitops 레포에서 그 릴리스 PR 을 revert 하는 PR → 승인 · merge (이전 이미지 · revision · 프론트 version 으로 돌아감). 롤백 하한보다 이전으로는 가지 않습니다 |
| 프론트만 문제 | gitops `envs/prod/frontend/values.yaml` 의 `version` 을 이전 릴리스 SHA 로 바꾸는 PR (backend · payment 는 그대로). S3 수명 주기(180일) 안의 SHA 만 가능 |
| 백엔드만 문제 | gitops `envs/prod/backend` 의 `imageTag` · `revision` 을 이전 릴리스 SHA 로 바꾸는 PR (프론트는 그대로, 롤백 하한 이후 SHA 만) |
| `sync-frontend-version` 실패 | gitops 레포 Actions 에서 재실행 (`workflow_dispatch`). `releases/<SHA>/index.html 이 없습니다` 면 그 SHA 의 release.yml Promote 프론트 업로드를 확인 |
| main 에 잘못 merge 됨 | gitops PR 을 merge 하지 않으면 운영은 바뀌지 않습니다. 모노레포는 revert PR(develop) → 다음 릴리스 |

## 운영 시드

메인 DB(RDS)는 매일 새로 만들어지므로, backend 배포 때마다 backend 차트의 **seed Job** 이 초기 데이터를 채웁니다 (`backend/values.yaml` 의 `seed`, LDP-141). 사람이 실행할 단계는 없습니다.

| 항목 | 내용 |
|---|---|
| 실행 | `backend/scripts/seed.ts` (이미지 ECR `team04-hotel/seed:<main SHA>`, `backend/scripts/Dockerfile.seed`, develop 파이프라인이 빌드 → release.yml 이 ECR 로 복사). Job 이름 `seed-<태그 앞 8자>-<spec 해시 6자>` — Job spec 은 바꿀 수 없어 seed 설정 · 차트가 바뀌면 새 이름으로 다시 만든다 (같은 이름으로 spec 이 바뀌면 helm 이 실패해 backend 전체가 롤백됨) |
| 순서 | Flyway hook(`main-db-migration`) 다음, 앱 Deployment 와 같이 생성. hook 이 아니라 helm `--wait` 가 기다리지 않음 → **시드가 실패해도 서비스 배포는 롤백되지 않음** |
| 데이터 | 관리자 계정 · 호텔 3 · 객실 종류 12 · 호실 60 · 편의시설 · 예약 가능일 365일 · 객실 사진 24장. 이미 있으면 건너뜀(멱등) |
| 관리자 계정 | Secret `seed-admin` ← Secrets Manager `team04-hotel/prod/seed-admin` (Terraform 12-secrets 🔒, 값은 그 디렉터리 `.env` 의 `SEED_ADMIN_*`) |
| 객실 사진 | 사진 버킷(13-frontend 🔒, 매일 재생성 안 함)에 고정 키 `room-types/<객실 종류 ID>/seed-<파일>` 로 올림. 같은 키가 있으면 올리지 않고(조건부 쓰기 `If-None-Match`) DB 만 다시 연결 → 매일 재생성해도 객체가 늘지 않음. 관리자가 올린 사진은 기존대로 uuid 키 |
| DB 접속 | `DB_SSL=true` + RDS CA(`rds-ca-bundle`) — 서버 인증서 · 호스트 이름 검증(`libs/common` `mariaDbSslOptions` 의 `verifyIdentity`, 서비스와 같은 코드). `require_secure_transport` 를 켜도 접속 |
| 권한 | SA `backend/seed` → IRSA `team04-hotel-seed` (사진 버킷 `room-types/*` PutObject 만, 버킷 정책 쓰기 허용 목록에도 포함) |

확인 (CP 에 SSM 접속 후):

```bash
k -n backend get jobs -l app.kubernetes.io/name=seed     # COMPLETIONS 1/1
k -n backend logs -l app.kubernetes.io/name=seed --tail=-1  # "[seed] 시딩 완료", 사진 "새로 올린 파일 N개"
k -n backend get externalsecret seed-admin                # SecretSynced
```

- 끝난 Job 은 하루 뒤 정리됩니다 (`ttlSecondsAfterFinished`). 실패하면 2번 다시 시도하고(`backoffLimit`) 파드 로그를 남깁니다.
- 다시 돌리려면 `k -n backend delete job -l app.kubernetes.io/name=seed` 합니다. ArgoCD selfHeal 이 없어진 Job 을 다시 만듭니다. 멱등이라 데이터가 늘지 않습니다.
- 관리자 비밀번호를 바꾸면(12-secrets version 증가) 다음 DB 재생성부터 반영됩니다.
