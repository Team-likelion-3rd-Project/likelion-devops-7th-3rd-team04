# 메인 DB 마이그레이션 (Flyway)

메인 DB(`DB_DATABASE=hotel_service`)는 hotel-service와 booking-service가 같이 쓰는 하나의 물리 DB라서,
두 서비스의 테이블 구조를 **이 폴더 하나**에서 같이 관리합니다(Flyway는 DB 하나당
`flyway_schema_history` 테이블을 하나만 쓰기 때문에, 서비스별로 폴더를 나눠도 결국 같은
히스토리를 공유하게 되어 의미가 없습니다).

hotel-service/booking-service는 `synchronize: false`라서 테이블을 직접 만들거나 고치지 않습니다.
user-service/auth-service는 아직 `synchronize: true`로 남아있고(users/admins/credentials 등 별도
테이블), 이 폴더가 관리하는 테이블과는 겹치지 않습니다.

## 규칙

payment-service의 마이그레이션 규칙과 동일합니다.

- 파일 이름: `V<버전>__<설명>.sql` (밑줄 2개)
- **이미 적용된 파일은 수정하지 않습니다.** 바꿀 게 있으면 다음 번호로 새 파일을 추가하세요.
- 컬럼을 바꾸면 관련 서비스의 `src/entities/*.entity.ts` 선언도 같이 맞춥니다.

## 버전

| 버전 | 내용 | 대상 서비스 |
|---|---|---|
| V1 | hotels/rooms/facilities/room_images/room_availabilities/reservations/reservation_facilities 기준선 (synchronize가 만들던 구조 그대로) | hotel-service, booking-service |
| V2 | 같은 서비스 안 FK 5개 추가 (ERD 위키 "FK 관계" 1~5번) | hotel-service, booking-service |

V3(reservations 상태 확장 + payment_due_at), V4(payment_attempts/payment_result_inbox)는
[LDP-24](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/issues/36)에서
이어서 추가합니다.

## 실행

- 로컬: `docker compose --profile local-infra up` 하면 `main-db-migration` 서비스가 자동 실행됩니다.
- 적용 현황 확인: 메인 DB의 `flyway_schema_history` 테이블을 조회합니다.
