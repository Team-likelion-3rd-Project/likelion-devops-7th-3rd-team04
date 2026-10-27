# backend-deploy

backend(NestJS 마이크로서비스 8개)와 챗봇 AI 스택(llm-service · n8n)의 Kubernetes 배포 매니페스트입니다. 파이프라인과 클러스터 구성 전체는 [infra/ansible/README.md 12절](../infra/ansible/README.md#12-cicd-kas--registry--agent--파이프라인)을 보세요.

```
backend-deploy/
├── charts/backend/        # Helm 차트 (umbrella 1개 — values 의 services.* 를 돌며 Deployment/Service/HPA 생성)
│   ├── values.yaml        # 공통 기본값: 포트, healthPort, env, secretEnv, probe, 리소스
│   ├── templates/         # deployment, service, hpa, ingress(api-gateway), migration-job(메인 · 결제 DB Flyway hook), n8n
│   └── files/n8n/         # n8n 워크플로 · 활성화 스크립트 (langchain_rag/n8n 의 사본 — CI helm-lint 가 원본과 비교)
└── gitops-seed/           # GitLab team04/infra/backend-gitops 의 초기 내용 (Ansible 이 1회 커밋)
    └── envs/dev/values.yaml.j2   # dev 전용 — prod values 는 GitHub 별도 prod gitops 레포
```

## 규칙

- 헬스체크는 모든 서비스가 `GET /health` 입니다 (`libs/common` HealthController). HTTP 서비스는 서비스 포트, gRPC 서비스는 `gRPC 포트 + 100` 포트를 `healthPort` 에 적습니다.
- 서비스가 새 Secret key 를 쓰면 `values.yaml` 의 `secretEnv` 와 `infra/ansible/inventory/group_vars/all.yml` 의 `backend_external_secret_data`(dev ExternalSecret · OpenBao 경로) 에 같이 추가하고, OpenBao 에 값을 넣습니다 (infra/ansible README 16절). prod 는 `infra/gitops/prod/backend-secrets` 와 Terraform 41-main-data Secret 에 추가합니다.
- prod 전용 기능(서비스별 ServiceAccount `serviceAccounts.create`, `global.imageRegistry` · `services.*.env` 의 tpl 렌더링, Flyway `db.jdbcParams` · `db.caConfigMap`, 시드 Job `seed.enabled`)은 기본값이 꺼져 있어 dev 렌더 결과에 영향이 없습니다.
- Service 는 기본 ClusterIP 입니다. 클러스터 밖(온프레미스 결제 노드)에서 호출해야 하는 서비스만 환경별 values 에 `nodePort` 를 지정하면 NodePort 가 됩니다 (dev: booking-service 30303, pg-mock-service 30307 — [infra/ansible/README.md 14절](../infra/ansible/README.md#14-결제-서버-노드-결제-db--payment-service--elasticmq)).
- DB 스키마는 `migrations.<이름>` 마다 pre-install/pre-upgrade hook Job(`<이름>-db-migration`)이 Flyway 로 적용합니다. `main`(backend/migrations, Secret 의 `DB_*`), `payment`(apps/payment-service/migrations, `PAYMENT_DB_*`). 앱은 모두 `synchronize: false` 라 이 Job 이 실패하면 배포를 중단합니다. dev 는 결제 노드가 결제 마이그레이션을 실행하므로 `migrations.payment.enabled: false`.
- 챗봇 AI 스택은 기본 꺼짐입니다(`services.llm-service.enabled`, `n8n.enabled`). dev 는 gitops 에서 켭니다 — 값과 Secret key 는 [infra/ansible/README.md 15절](../infra/ansible/README.md#15-챗봇-ai-스택-llm-service--n8n-vertex-ai). llm-service 는 범용 Deployment 템플릿을 그대로 쓰고(`GET /health`, 포트 8000), n8n 은 워크플로 import · 활성화 때문에 전용 템플릿(`templates/n8n.yaml`)을 씁니다.
- 초기 데이터 시딩 Job(`seed`, `templates/seed-job.yaml`, 이미지 `backend/scripts/Dockerfile.seed`)은 기본 꺼짐입니다. prod 는 메인 DB 를 매일 새로 만들기 때문에 켭니다 ([infra/gitops/prod/README.md "운영 시드"](../infra/gitops/prod/README.md#운영-시드)). dev 도 gitops 에서 켭니다 — 롤백 때 `migrations.main.resetOnDowngrade` 로 DB 를 다시 만든 뒤 그 버전의 seed.ts 가 다시 채웁니다 ([infra/ansible/README.md 12-5](../infra/ansible/README.md#12-5-파이프라인-사용--dev-배포-절차)). hook 이 아닌 일반 Job 이라 마이그레이션 뒤에 실행되고, 실패해도 배포를 되돌리지 않습니다.
- 차트에는 Namespace 같은 클러스터 범위 리소스를 넣지 않습니다. CI agent 의 권한이 `backend` 네임스페이스 안으로 제한되어 있습니다.
- 차트 구조가 바뀌면 `Chart.yaml` 의 `version` 을 올립니다.

## 로컬 확인

```bash
helm lint backend-deploy/charts/backend --set global.imageTag=test
helm template backend backend-deploy/charts/backend -n backend --set global.imageTag=test --set ingress.enabled=true
helm template backend backend-deploy/charts/backend -n backend --set global.imageTag=test --set services.llm-service.enabled=true --set n8n.enabled=true
```
