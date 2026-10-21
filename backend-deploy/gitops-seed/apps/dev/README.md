# apps/dev

온프레미스 dev 클러스터 ArgoCD 의 root app(`dev-apps`)이 이 디렉터리의 `*.yaml` 을 Application 으로 만듭니다.

- root app · AppProject · 레포 자격증명은 Ansible(`infra/ansible` `k8s-cicd.yml` → `roles/argocd`)이 관리합니다.
- 파일을 추가하면 Application 이 생기고, 지우면 Application 만 삭제됩니다 (finalizer 가 없어 앱 리소스는 남음).
- 이 README 는 Ansible(`gitlab.yml --tags bootstrap`)이 커밋합니다. root app 이 경로를 찾을 수 있도록 디렉터리를 유지하는 용도입니다.
