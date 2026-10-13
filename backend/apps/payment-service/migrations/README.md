# payment-service DB 마이그레이션 (Flyway)

결제 DB(`PAYMENT_DB_DATABASE`)의 테이블 구조는 이 폴더의 SQL 파일로만 바꿉니다.
payment-service는 `synchronize: false`라서 테이블을 직접 만들거나 고치지 않습니다.

## 규칙
- 파일 이름: `V<버전>__<설명>.sql` (밑줄 2개). 예: `V4__add_payments_cancel_reason.sql`
- **이미 적용된 파일은 수정하지 않습니다.** Flyway가 파일 체크섬을 기록해 두기 때문에, 고치면 다음 실행 때
  검증 오류가 납니다. 바꿀 게 있으면 다음 번호로 새 파일을 추가하세요.
- 컬럼을 바꾸면 `src/entities/*.entity.ts` 선언도 같이 맞춥니다.

## 버전 (ERD 위키 "마이그레이션 · 결제 DB"와 같은 순서)
| 버전 | 내용 |
|---|---|
| V1 | `payments` 기준선 (2차 구조 그대로) |
| V2 | `payments` 확장: 멱등 키·PG 주문번호·provider, 상태 7종 전환, 예약당 승인 1건 UNIQUE |
| V3 | `payment_outbox`, `pg_webhook_inbox` 생성 |

## 실행
- 로컬: `docker compose --profile local-infra up` 하면 `payment-db-migration` 서비스가 자동 실행됩니다.
- 적용 현황 확인: 결제 DB의 `flyway_schema_history` 테이블을 조회합니다.
