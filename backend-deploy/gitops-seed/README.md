# backend-gitops

backend 의 **dev 배포 상태**(Helm values + 이미지 태그)를 담는 레포입니다.

- 차트: GitHub 모노레포 `backend-deploy/charts/backend` (GitLab `team04/hotel` 로 미러)
- `envs/dev/values.yaml`: 온프레미스 dev 클러스터 (`dev-agent`)
- prod(AWS EKS) 배포 상태는 이 레포가 아니라 **GitHub 의 별도 prod gitops 레포**에서 PR 로 관리합니다 (보호 규칙으로 PR 필수, 변경 이력 보존).

## 이미지 태그

`global.imageTag` 는 `team04/hotel` 파이프라인의 `deploy-dev` job 이 커밋 SHA 로 갱신하고 커밋합니다.
배포(`helm upgrade --atomic`)가 실패하면 같은 job 이 그 커밋을 revert 하므로, 이 레포의 값은 항상 클러스터에 실제로 배포된 상태와 같습니다.

## ArgoCD 전환 후

dev 에 ArgoCD 를 도입하면 Application 이 이 레포를 바라보게 됩니다 (multi-source: 차트는 `team04/hotel`, values 는 이 레포의 `$values/envs/dev/values.yaml`).
그때부터 CI 는 태그 커밋만 하고, 배포는 ArgoCD 가 sync 합니다.

> 처음 내용은 GitHub 모노레포 `backend-deploy/gitops-seed` 에서 Ansible(`gitlab.yml --tags bootstrap`)이 한 번만 커밋했습니다. 이후 변경은 이 레포에서 직접 합니다.
