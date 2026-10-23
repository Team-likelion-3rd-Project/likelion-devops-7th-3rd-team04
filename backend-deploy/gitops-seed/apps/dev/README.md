# apps/dev

온프레미스 dev 클러스터 ArgoCD 의 root app(`dev-apps`)이 이 디렉터리의 `*.yaml` 을 Application 으로 만듭니다.

- root app · AppProject · 레포 자격증명은 Ansible(`infra/ansible` `k8s-cicd.yml` → `roles/argocd`)이 관리합니다.
- 파일을 추가하면 Application 이 생기고, 지우면 Application 만 삭제됩니다 (finalizer 가 없어 앱 리소스는 남음).
- `backend.yaml` 의 `sources[0].targetRevision`(차트 커밋)은 CI `deploy-dev` 가 `envs/dev/values.yaml` 의 이미지 태그와 같은 커밋으로 함께 갱신합니다.
- 이 README 는 Ansible(`gitlab.yml --tags bootstrap`)이 커밋합니다.
