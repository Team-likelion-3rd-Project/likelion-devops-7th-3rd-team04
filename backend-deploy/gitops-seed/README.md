# backend-gitops

backend 의 **dev 배포 상태**(Helm values · 이미지 태그 · ArgoCD Application)를 담는 레포입니다. 온프레미스 dev 클러스터의 ArgoCD 가 이 레포의 `main` 을 sync 합니다.

- 차트: GitHub 모노레포 `backend-deploy/charts/backend` (GitLab `team04/hotel` 로 미러)
- `envs/dev/values.yaml`: dev values · 이미지 태그
- `apps/dev/backend.yaml`: ArgoCD Application (차트 = `team04/hotel` 의 커밋, values = 이 레포의 `$values/envs/dev/values.yaml`)
- prod(AWS EKS) 배포 상태는 이 레포가 아니라 **GitHub 의 별도 prod gitops 레포**에서 PR 로 관리합니다 (보호 규칙으로 PR 필수, 변경 이력 보존).

## main 커밋 = 배포

ArgoCD 는 자동 sync(prune · selfHeal)라 `main` 에 커밋하면 최대 3분 안에 클러스터에 반영됩니다.

| 변경 | 방법 |
|---|---|
| 새 버전 (이미지 · 차트) | `team04/hotel` develop 파이프라인의 `deploy-dev` ▶ — `envs/dev/values.yaml` 의 `global.imageTag`(short SHA)와 `apps/dev/backend.yaml` 의 `sources[0].targetRevision`(full SHA)을 커밋 1개로 갱신 |
| dev values (env · 활성화할 서비스 등) | 브랜치 · MR 로 준비 → **배포 일정에 merge** |
| 롤백 | 이전 파이프라인의 `deploy-dev` ▶ 또는 해당 커밋 revert |

- 배포 결과(sync · health · 마이그레이션 hook)는 ArgoCD UI 에서 확인합니다. 실패해도 자동으로 되돌리지 않으므로(이전 파드가 계속 서비스) 수정 커밋이나 롤백으로 복구합니다.
- 클러스터를 kubectl 로 직접 고친 변경은 selfHeal 이 되돌립니다 (HPA 의 replicas, `kubectl rollout restart` 는 예외).

> 처음 내용은 GitHub 모노레포 `backend-deploy/gitops-seed` 에서 Ansible(`gitlab.yml --tags bootstrap`)이 한 번만 커밋했습니다. 이후 변경은 이 레포에서 직접 합니다.
