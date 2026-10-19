# infra/gitops/prod — 운영(AWS) 클러스터 배포 상태 원본

이 폴더는 gitops 레포 [`likelion-devops-7th-3rd-team04-gitops`](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04-gitops) 의 `envs/prod/` 와 **1:1 로 같은 구조**입니다. 운영 Main 클러스터는 gitops 레포 `main` 을 읽어 배포합니다 (아래 "배포 agent").

## 원본 규칙

- **이 폴더가 원본입니다.** 값을 바꿀 때는 여기를 먼저 고치고, gitops 레포 `envs/prod/` 에 같은 내용을 반영합니다.
- 반영 방법
  - v1.0.0(2026-10-27) 전(구축 기간): 이 폴더 변경과 같은 내용으로 gitops 레포에 PR 을 직접 작성합니다.
  - 이후: 모노레포 릴리스 PR(develop → main) merge 때 GitLab main 파이프라인이 gitops 레포에 PR 을 엽니다(values 복사 + 이미지 태그 + chart revision). 사람이 gitops 레포에 직접 PR 을 여는 것은 비상 경로뿐입니다.
- gitops 레포에만 있는 값을 만들지 않습니다. 두 곳이 다르면 이 폴더 기준으로 맞춥니다.
- public 레포로 그대로 복사되므로 **비밀값을 넣지 않습니다** (AWS Secrets Manager → External Secrets).
- 아직 옮기지 않은 앱(`backend`, `payment`)은 gitops 레포 쪽이 기준입니다 (LDP-79 에서 이관).

```
infra/gitops/prod/          (= gitops 레포 envs/prod/)
├── traefik/   chart.yaml · values.yaml          Ingress Controller (워커 NodePort 30080)
└── whoami/    chart.yaml · values.yaml · chart/  수직 경로 검증용 테스트 백엔드 (/whoami)
```

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
| `order` | | 적용 순서, 작은 값부터 (기본 50). 예: Traefik 10 → whoami 20 → backend 30 |
| `enabled` | | `false` 면 배포 · 렌더링 검증에서 뺌 (기본 `true`) |

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

## ArgoCD 전환

- 앱 폴더 하나 = Application 하나입니다. `type: helm` → `chart` · `repoURL` · `targetRevision: version`, `type: git` → `repoURL` · `path` · `targetRevision: revision` + values 는 gitops 레포 `$values`, `type: local` → gitops 레포 `path`. `order` 는 sync-wave 로 옮깁니다.
- 전환일은 재생성으로 처리합니다. Ansible 에서 `gitops_sync` 대신 ArgoCD 를 설치하면 CronJob 은 생기지 않습니다.
