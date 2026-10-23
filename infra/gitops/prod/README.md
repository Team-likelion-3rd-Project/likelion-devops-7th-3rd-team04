# infra/gitops/prod — 운영(AWS) 클러스터 배포 상태 원본

이 폴더는 gitops 레포 [`likelion-devops-7th-3rd-team04-gitops`](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04-gitops) 의 `envs/prod/` 와 **1:1 로 같은 구조**입니다. 운영 Main 클러스터는 gitops 레포 `main` 을 읽어 배포합니다 (아래 "배포 agent").

## 원본 규칙

- **이 폴더가 원본입니다.** 값을 바꿀 때는 여기를 먼저 고치고, gitops 레포 `envs/prod/` 에 같은 내용을 반영합니다.
- 반영 방법
  - v1.0.0(2026-10-27) 전(구축 기간): 이 폴더 변경과 같은 내용으로 gitops 레포에 PR 을 직접 작성합니다.
  - 이후: 모노레포 릴리스 PR(develop → main) merge 때 GitLab main 파이프라인이 gitops 레포에 PR 을 엽니다(values 복사 + 이미지 태그 + chart revision). 사람이 gitops 레포에 직접 PR 을 여는 것은 비상 경로뿐입니다.
- gitops 레포에만 있는 값을 만들지 않습니다. 두 곳이 다르면 이 폴더 기준으로 맞춥니다.
- public 레포로 그대로 복사되므로 **비밀값을 넣지 않습니다** (AWS Secrets Manager → External Secrets).
- 아직 옮기지 않은 `payment`(결제 서버 이미지 태그, 앱 정의 아님)는 gitops 레포 쪽이 기준입니다 (결제 단계에서 이관).
- `frontend`(프론트 버전 · 빌드 설정)도 앱 정의가 아닙니다. agent 는 읽지 않고, merge 후 gitops `sync-frontend-version` workflow 가 CloudFront KeyValueStore 에 씁니다 (아래 "릴리스").

```
infra/gitops/prod/          (= gitops 레포 envs/prod/)
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
- webhook 은 `failurePolicy: Fail` 입니다. webhook 이 준비되기 전에 만든 파드가 자격 증명 없이 남지 않고, 생성이 거부된 뒤 다시 만들어집니다. 노드 · 네트워크 · 인증서 · 배포 agent 네임스페이스는 호출하지 않습니다 (`values.yaml` namespaceSelector).

## 클러스터 값 (`clusterValues`)

public 레포에 둘 수 없는 클러스터 값(계정 ID 등)은 Ansible 이 CP-a 부트스트랩 때 ConfigMap `gitops-sync/gitops-sync-cluster-values` 로 만듭니다 (`group_vars/aws_control_plane.yml` 의 `gitops_sync_cluster_values`). `chart.yaml` 에 `clusterValues: true` 인 앱에만 agent 가 앱 `values.yaml` 다음에 `-f` 로 넘깁니다 (모르는 키를 거부하는 차트 schema 가 있어 모든 앱에 넘기지 않음).

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
| `order` | | 적용 순서, 작은 값부터 (기본 50). 같으면 폴더 이름 순 |
| `enabled` | | `false` 면 배포 · 렌더링 검증에서 뺌 (기본 `true`) |
| `clusterValues` | | `true` 면 클러스터 값(아래)을 `-f` 로 더 넘김 (기본 `false`) |

## 배포 agent (ArgoCD 도입 전)

ArgoCD 는 온프레미스 도입 전까지 운영에 먼저 적용하지 않기로 해서, 같은 pull 모델을 CronJob 으로 구현했습니다. 설치는 Ansible `roles/gitops_sync` (CP-a 부트스트랩, [Ansible README](../../ansible/README.md) 13절), 스크립트는 [`gitops-sync.sh`](../../ansible/roles/gitops_sync/files/gitops-sync.sh) 입니다.

```
CronJob gitops-sync (1분, CP 노드, cluster-admin)
  1) gitops 레포 BRANCH 의 SHA 조회 ── applied_sha 또는 failed_sha 와 같으면 종료
  2) 가져오기: 그 SHA + 앱별 차트(helm pull · git fetch) ── 실패: 기록 없이 종료 → 다음 실행이 재시도
  3) 적용: order 순 helm upgrade --install --atomic ── 실패: failed_sha 기록 → 브랜치가 바뀔 때까지 재시도 안 함
     전부 성공: applied_sha 기록
```

- **가져오기와 적용 실패를 나눕니다.** 네트워크 장애(GitHub · 차트 저장소)로 SHA 가 실패로 기록되면 새 커밋 전까지 배포가 멈추므로, 네트워크를 쓰는 단계는 재시도하고 값 문제(렌더링 오류, readiness 실패)만 기록합니다. 존재하지 않는 차트 버전도 가져오기 실패라 매 분 재시도합니다 (클러스터는 바뀌지 않음).
- **적용은 앱 단위입니다.** 앞 앱이 적용된 뒤 뒤 앱이 실패하면 앞 앱은 새 버전으로 남고, 실패한 앱만 `--atomic` 으로 이전 릴리스로 돌아갑니다.
- **값이 같으면 파드는 바뀌지 않습니다.** SHA 가 바뀌면 모든 앱에 `helm upgrade` 를 하지만, 렌더 결과가 같은 앱은 revision 만 늘어납니다 (`--history-max 5`).
- **ArgoCD 와 다른 점:** 클러스터를 직접 고친 변경(drift)은 되돌리지 않고(같은 SHA 면 건너뜀), 앱 폴더를 지워도 릴리스를 삭제하지 않습니다(`helm uninstall` 은 사람이 함).
- 부트스트랩: CronJob 을 멈춘 채로 만들고 첫 실행 Job 을 바로 띄운 뒤, 끝나면 CronJob 을 재개합니다 (helm 이 동시에 돌지 않게). 부트스트랩이 실패해도 CP 부트스트랩은 실패시키지 않습니다 (실패 시 CP 가 교체되는데, 원인이 gitops 값이면 교체해도 같음).
- 보안: CRD · ClusterRole 을 설치하므로 cluster-admin 입니다. 읽는 곳은 ruleset 으로 보호된 gitops 레포 하나(ArgoCD 와 같은 신뢰 모델)이고, 파드는 앱이 뜨지 않는 CP 에서 non-root · 읽기 전용 루트 파일시스템으로 돕니다. 이미지(`alpine/k8s`)는 digest 로 고정합니다.

### 확인 · 운영 (CP 에 SSM 접속 후)

```bash
alias k='sudo kubectl --kubeconfig /etc/kubernetes/admin.conf'
k -n gitops-sync get configmap gitops-sync-state -o yaml   # applied_sha · failed_sha · failed_app · message
k -n gitops-sync get jobs                                  # 최근 실행 (성공 1개 · 실패 3개 보관)
k -n gitops-sync logs job/<job 이름>
k -n gitops-sync create job manual-$(date +%s) --from=cronjob/gitops-sync   # 1분 기다리지 않고 바로 실행
```

| 상황 | 하는 일 |
|---|---|
| 값이 잘못되어 `failed_sha` 가 기록됨 | 수정 커밋을 gitops 레포에 반영 (같은 SHA 는 다시 시도하지 않음) |
| 가져오기 실패가 계속됨 | Job 로그의 URL · 차트 버전 확인. 네트워크면 NAT · CP SG egress |
| 같은 SHA 를 다시 적용하고 싶음 | `k -n gitops-sync patch configmap gitops-sync-state --type merge -p '{"data":{"applied_sha":"","failed_sha":""}}'` |
| `another operation (install/upgrade/rollback) is in progress` | agent 파드가 helm 도중 종료된 경우. `helm -n <ns> history <release>` 로 확인 후 `helm -n <ns> rollback <release>` |

### 작업 브랜치로 검증

gitops 레포 작업 브랜치에 push 한 뒤, 대상 브랜치를 바꿉니다. **검증이 끝나면 `main` 으로 되돌립니다** (매일 재생성 때도 Ansible `gitops_sync_branch: main` 으로 다시 만들어짐).

```bash
k -n gitops-sync patch configmap gitops-sync-config --type merge -p '{"data":{"BRANCH":"<작업 브랜치>"}}'
k -n gitops-sync patch configmap gitops-sync-config --type merge -p '{"data":{"BRANCH":"main"}}'   # 복구
```

## 릴리스

```
develop ──릴리스 PR (merge commit, release-source check · 승인)──▶ main
   │                                                            │ GitHub → GitLab 미러
   │                                                            ▼
   │                         GitLab main 파이프라인 (AWS Runner, 보호 브랜치 · tags aws — release job 만)
   │                           release:prepare → release:build ×10 (ECR 캐시) ─┐
   │                           release:frontend-build → release:frontend ───────┴→ release:gitops-pr
   │                           ECR team04-hotel/<서비스>:<main SHA> (arm64)          gitops 레포 PR release/<main SHA>
   │                           S3 team04-hotel-frontend/releases/<main SHA>/              │ validate · 승인 (사람)
   ▼                                                                                        ▼ merge
(다음 개발)        메인 클러스터 배포 agent (1분)  ·  결제 서버: GitHub Actions → Parameter Store → pull agent
                   프론트: GitHub Actions → CloudFront KeyValueStore version → CloudFront Function (수 초)
```

| 단계 | 누가 · 무엇으로 | 할 수 있는 것 |
|---|---|---|
| 릴리스 PR merge | 사람 (모노레포 main ruleset: 승인 · `release-source` · GitHub CI check) | main 갱신 |
| 이미지 빌드 · ECR push | GitLab main 파이프라인 — AWS Runner Role | `team04-hotel/*` push 만 (ECR 저장소 정책이 다른 주체의 push 거부) |
| 프론트 빌드 · S3 업로드 | `release:frontend-build` · `release:frontend` — AWS Runner Role | 사이트 버킷 `releases/*` PutObject 만 (운영 버전 전환 불가, 버킷 정책이 다른 주체의 쓰기 거부) |
| gitops 릴리스 PR 생성 | `release:gitops-pr` — GitHub App(`team04-hotel-release-bot`, gitops 레포에만 설치) | 브랜치 push · PR 생성까지. main merge 는 ruleset 이 막음 |
| 운영 반영 | 사람이 gitops PR 승인 · merge | 메인: 배포 agent / 결제: Parameter Store 동기화(GitHub OIDC Role, 파라미터 하나) / 프론트: KeyValueStore `version` 갱신(같은 Role, 키 하나 — S3 쓰기 불가) |

- 이미지 태그 = **main 커밋 SHA 40자**, backend `chart.yaml` 의 `revision` 과 같은 값입니다. ECR 은 IMMUTABLE 이라 같은 태그로 다시 push 할 수 없습니다.
- Runner 에는 Parameter Store · KeyValueStore 쓰기 권한이 없습니다. 결제 서버 태그 · 프론트 버전은 gitops PR 이 승인 · merge 된 뒤에만 바뀝니다.
- 프론트 빌드 설정(`VITE_*`)은 이 폴더의 `frontend/values.yaml` `build` 입니다. 토스 클라이언트 키(`VITE_TOSS_CLIENT_KEY`)만 레포에 두지 않고 Terraform `12-secrets` 의 Parameter Store 에서 `release:prepare` 가 읽어 넘깁니다. 빌드 결과에 들어가므로 gitops 레포에서 바꿔도 반영되지 않고, 여기서 고친 뒤 새 릴리스로 냅니다. 의존성 설치는 `npm ci --ignore-scripts` 입니다 (job 도 Runner Role 을 받음).
- 프론트는 버전마다 경로(`releases/<SHA>/`)가 달라 전환 · 롤백에 재업로드 · CloudFront 무효화가 없습니다. `assets/` 는 1년 immutable, 그 외(`index.html` · `favicon.svg` 등)는 no-cache 로 올립니다.
- GitLab 미러의 main 은 보호 브랜치여야 AWS Runner(protected)가 job 을 받습니다.
- main 파이프라인은 lint · test · compile · dev 이미지 빌드를 다시 돌리지 않습니다. 그 검증은 같은 커밋의 **develop 파이프라인**이 맡으므로 아래 절차 1 에서 확인합니다.
- 빌드 레이어 캐시는 ECR `team04-hotel/cache`(11-registry, 상시 유지, 14일 뒤 삭제)에 둡니다. 소스만 바뀐 릴리스는 `npm ci` 레이어를 캐시에서 가져옵니다 (job 로그 끝의 `[캐시] 적중 N`).

### 절차 (runbook)

1. **준비**: develop 이 dev 에 배포 · 검증된 상태인지 확인합니다. 결제 쪽 계약(payment.proto · SQS 메시지 · 결제 마이그레이션)이 바뀌었으면 결제 서버를 먼저 반영할 계획을 세웁니다.
   - **develop 파이프라인 성공 확인 (필수)**: 릴리스 PR 의 head 커밋(develop 최신 커밋)에 대한 GitLab `team04/hotel` develop 파이프라인이 **passed** 인지 확인합니다 (Pipelines → 브랜치 develop → 커밋 SHA 비교). 실행 중이면 끝날 때까지 기다리고, 실패했으면 develop 에서 고친 뒤 다시 확인합니다. main 파이프라인은 test · 이미지 smoke test 를 다시 돌리지 않습니다.
2. **릴리스 PR**: GitHub 에서 `develop → main` PR 을 엽니다 (제목 예: `release: v1.0.0`). `release-source` · GitHub CI(`Backend Build & Test` 등) check 와 승인 후 **merge commit** 으로 합칩니다.
3. **파이프라인**: GitLab `team04/hotel` → Pipelines 의 main 파이프라인이 `release:gitops-pr` 까지 끝나는지 확인합니다.
   - 소요 시간 (merge → gitops PR 생성): rc.1(2026-10-21, t4g.medium · 캐시 없음 · main 에 dev job 포함) 약 28분 — 온프레미스 Runner 대기 + compile · helm-lint 17분, `release:build` 9분. 개선 후 실측은 rc.2 때 여기에 적습니다.
   - `release:build` 로그 끝의 `[메모리]` 줄(호스트 남은 메모리 최소 · job 최대 사용량)로 Runner 사양을 판단합니다.
4. **gitops PR**: gitops 레포에 `chore(prod): backend · payment · frontend → <SHA 8자>` PR 이 생깁니다. 본문의 "이전 릴리스 대비 변경" 링크로 바뀐 내용을 보고, `validate` 통과 확인 후 승인 · merge 합니다.
5. **반영 확인**
   - 메인: CP 에서 `k -n gitops-sync get configmap gitops-sync-state -o yaml` 의 `applied_sha` 가 gitops merge 커밋인지, `k -n backend get pods` 가 새 이미지로 Running 인지 (위 "확인 · 운영")
   - 결제: gitops 레포 Actions 의 Parameter Store 동기화 workflow 성공 → 결제 서버 pull agent 반영 (결제 단계에서 구성)
   - 프론트: gitops 레포 Actions `sync-frontend-version` 성공(로그의 `갱신: <이전> → <SHA>`) → 브라우저 새로고침 후 개발자 도구 Network 에서 `index-*.js` 이름이 바뀌었는지
6. **태그**: 모노레포 main 의 merge 커밋에 버전 태그를 붙입니다 (`git tag v1.0.0 <SHA> && git push origin v1.0.0`, 리허설은 `v1.0.0-rc.1`).

### 긴급 수정 (hotfix)

`main` 에서 `hotfix/<이름>` 브랜치를 만들어 수정 → `hotfix/<이름> → main` PR(merge commit) → 위 3 – 6 과 같습니다. 같은 브랜치로 `→ develop` PR(squash)도 열어 develop 에 반영합니다.

### 실패했을 때

| 상황 | 하는 일 |
|---|---|
| `release:build` 일부 실패 | 해당 job 을 재시도합니다. 이미 push 된 이미지는 `release:prepare` 가 건너뛰게 표시합니다 (IMMUTABLE 충돌 없음) |
| `release:gitops-pr` 실패 · 재시도 | 같은 SHA 의 PR 이 열려 있으면 만들지 않고 끝납니다 |
| 운영에서 문제 발견 | gitops 레포에서 그 릴리스 PR 을 revert 하는 PR → 승인 · merge (이전 이미지 · revision · 프론트 version 으로 돌아감) |
| 프론트만 문제 | gitops `envs/prod/frontend/values.yaml` 의 `version` 을 이전 릴리스 SHA 로 바꾸는 PR (backend · payment 는 그대로). S3 수명 주기(180일) 안의 SHA 만 가능 |
| 백엔드만 문제 | gitops `envs/prod/backend` 의 `imageTag` · `revision` 을 이전 릴리스 SHA 로 바꾸는 PR (프론트는 그대로) |
| `release:frontend-build` 실패 | 로그 확인 (토스 클라이언트 키 Parameter 미등록이면 `12-secrets` 에 `TOSS_CLIENT_KEY` 등록 후 파이프라인 재실행 — `release:prepare` 부터) → 고친 뒤 재시도. gitops PR 은 프론트 업로드가 끝나야 만들어집니다 |
| `sync-frontend-version` 실패 | gitops 레포 Actions 에서 재실행 (`workflow_dispatch`). `releases/<SHA>/index.html 이 없습니다` 면 그 SHA 의 `release:frontend` 를 확인 |
| main 에 잘못 merge 됨 | gitops PR 을 merge 하지 않으면 운영은 바뀌지 않습니다. 모노레포는 revert PR(develop) → 다음 릴리스 |

## 운영 시드

메인 DB(RDS)는 매일 새로 만들어지므로, backend 배포 때마다 backend 차트의 **seed Job** 이 초기 데이터를 채웁니다 (`backend/values.yaml` 의 `seed`, LDP-141). 사람이 실행할 단계는 없습니다.

| 항목 | 내용 |
|---|---|
| 실행 | `backend/scripts/seed.ts` (이미지 ECR `team04-hotel/seed:<main SHA>`, `backend/scripts/Dockerfile.seed`, `release:build` 가 빌드). Job 이름 `seed-<태그 앞 8자>-<spec 해시 6자>` — Job spec 은 바꿀 수 없어 seed 설정 · 차트가 바뀌면 새 이름으로 다시 만든다 (같은 이름으로 spec 이 바뀌면 helm 이 실패해 backend 전체가 롤백됨) |
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
- 다시 돌리려면 `k -n backend delete job -l app.kubernetes.io/name=seed` 후 위 "확인 · 운영" 표의 "같은 SHA 를 다시 적용하고 싶음" 으로 backend 를 다시 적용합니다 (helm 이 없어진 Job 을 다시 만듦). 멱등이라 데이터가 늘지 않습니다.
- 관리자 비밀번호를 바꾸면(12-secrets version 증가) 다음 DB 재생성부터 반영됩니다.

## ArgoCD 전환

- 클러스터 값(`clusterValues`)은 ApplicationSet cluster generator 의 클러스터 Secret 값을 helm parameters 로 넘깁니다.
- 앱 폴더 하나 = Application 하나입니다. `type: helm` → `chart` · `repoURL` · `targetRevision: version`, `type: git` → `repoURL` · `path` · `targetRevision: revision` + values 는 gitops 레포 `$values`, `type: local` → gitops 레포 `path`. `order` 는 sync-wave 로 옮깁니다.
- 전환일은 재생성으로 처리합니다. Ansible 에서 `gitops_sync` 대신 ArgoCD 를 설치하면 CronJob 은 생기지 않습니다.
