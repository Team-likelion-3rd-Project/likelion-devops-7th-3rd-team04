# backend-deploy

backend(NestJS 마이크로서비스 8개)의 Kubernetes 배포 매니페스트입니다. 파이프라인과 클러스터 구성 전체는 [infra/ansible/README.md 12절](../infra/ansible/README.md#12-cicd-kas--registry--agent--파이프라인)을 보세요.

```
backend-deploy/
├── charts/backend/        # Helm 차트 (umbrella 1개 — values 의 services.* 를 돌며 Deployment/Service/HPA 생성)
│   ├── values.yaml        # 공통 기본값: 포트, healthPort, env, secretEnv, probe, 리소스
│   └── templates/         # deployment, service, hpa, ingress(api-gateway), migration-job(결제 DB Flyway hook)
└── gitops-seed/           # GitLab team04/infra/backend-gitops 의 초기 내용 (Ansible 이 1회 커밋)
    └── envs/{dev,prod}/values.yaml.j2
```

## 규칙

- 헬스체크는 모든 서비스가 `GET /health` 입니다 (`libs/common` HealthController). HTTP 서비스는 서비스 포트, gRPC 서비스는 `gRPC 포트 + 100` 포트를 `healthPort` 에 적습니다.
- 서비스가 새 Secret key 를 쓰면 `values.yaml` 의 `secretEnv` 와 `infra/ansible/inventory/group_vars/control_plane.yml` 의 `backend_secret_keys` 에 같이 추가합니다.
- 차트에는 Namespace 같은 클러스터 범위 리소스를 넣지 않습니다. CI agent 의 권한이 `backend` 네임스페이스 안으로 제한되어 있습니다.
- 차트 구조가 바뀌면 `Chart.yaml` 의 `version` 을 올립니다.

## 로컬 확인

```bash
helm lint backend-deploy/charts/backend --set global.imageTag=test
helm template backend backend-deploy/charts/backend -n backend --set global.imageTag=test --set ingress.enabled=true
```
