# 결제 DB 마이그레이션 이미지 — Helm pre-install/pre-upgrade hook Job(backend-deploy/charts/backend)이 실행합니다.
# 빌드 컨텍스트는 이 디렉터리 (backend/apps/payment-service/migrations).
# 로컬 docker compose 의 payment-db-migration 과 같은 Flyway 버전을 씁니다.
FROM flyway/flyway:11.3.4-alpine

COPY V*.sql /flyway/sql/

ENV FLYWAY_LOCATIONS=filesystem:/flyway/sql

# 접속 정보는 FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD 로 주입
CMD ["migrate"]
