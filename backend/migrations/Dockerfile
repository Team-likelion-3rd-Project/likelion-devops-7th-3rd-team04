# 메인 DB 마이그레이션 이미지 — 결제 DB 쪽(apps/payment-service/migrations/Dockerfile)과 같은 형식입니다.
# 클러스터 배포 시 Helm hook Job 이 앱보다 먼저 실행하도록 쓰입니다 (backend-deploy/charts/backend).
# 빌드 컨텍스트는 이 디렉터리 (backend/migrations).
# 로컬 docker compose 의 main-db-migration 과 같은 Flyway 버전을 씁니다.
FROM flyway/flyway:11.3.4-alpine

COPY V*.sql /flyway/sql/

ENV FLYWAY_LOCATIONS=filesystem:/flyway/sql

# 접속 정보는 FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD 로 주입
CMD ["migrate"]
