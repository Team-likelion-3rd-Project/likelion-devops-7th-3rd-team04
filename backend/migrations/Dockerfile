# 메인 DB 마이그레이션 이미지 — 결제 DB 쪽(apps/payment-service/migrations/Dockerfile)과 같은 형식입니다.
# 클러스터 배포 시 Helm hook Job 이 앱보다 먼저 실행하도록 쓰입니다 (backend-deploy/charts/backend).
# 빌드 컨텍스트는 이 디렉터리 (backend/migrations).
# 로컬 docker compose 의 main-db-migration 과 같은 Flyway 버전을 씁니다.
FROM flyway/flyway:11.3.4-alpine

# migrate.sh 가 flyway info 의 JSON 을 읽을 때 사용
RUN apk add --no-cache jq

COPY V*.sql /flyway/sql/
COPY migrate.sh /flyway/migrate.sh
RUN chmod 755 /flyway/migrate.sh

ENV FLYWAY_LOCATIONS=filesystem:/flyway/sql

# rollback-dev:check 가 이 label 로 "롤백 때 DB 를 이 버전에 맞출 수 있는 이미지" 인지 확인 (migrate.sh)
LABEL team04.migrations.reset="1"

# 접속 정보는 FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD 로 주입.
# migrate 는 migrate.sh 를 거침 — MIGRATE_RESET_ON_DOWNGRADE=true(dev)이면 롤백 때 DB 를 이 버전으로 다시 만듦 (migrate.sh 머리말)
ENTRYPOINT ["/flyway/migrate.sh"]
CMD ["migrate"]
