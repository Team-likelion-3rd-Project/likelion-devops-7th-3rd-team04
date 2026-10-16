# 메인 DB 마이그레이션 (Flyway)

메인 DB(`DB_DATABASE=hotel_service`)는 user-service·auth-service·hotel-service·booking-service가 같이 쓰는
하나의 물리 DB라서, 네 서비스의 테이블 구조를 **이 폴더 하나**에서 같이 관리합니다(Flyway는 DB 하나당
`flyway_schema_history` 테이블을 하나만 쓰기 때문에, 서비스별로 폴더를 나눠도 결국 같은
히스토리를 공유하게 되어 의미가 없습니다).

네 서비스 모두 `synchronize: false`라서 테이블을 직접 만들거나 고치지 않습니다. 메인 DB의 테이블은
**Flyway만** 만듭니다 (user/auth는 V6부터 — 그 전에는 user/auth가 Flyway보다 먼저 떠서 테이블을 만들면
Flyway가 "non-empty schema but no schema history"로 멈추는 문제가 있었습니다, LDP-60).

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
| V3 | reservations.status에 PAYMENT_FAILED/EXPIRED 추가, payment_due_at 컬럼(+기존 행 백필) 추가, (status, payment_due_at) 인덱스 | booking-service |
| V4 | payment_attempts/payment_result_inbox 생성 (FK 6~8번) | booking-service |
| V5 | reservations(user_id), reservations(room_id, check_in_date) 인덱스 추가 (V2 때 "FK+인덱스"였는데 인덱스만 누락됐던 것 뒤늦게 보강) | booking-service |
| V6 | users/deleted_user/admins/credentials/admin_credentials 기준선 (synchronize가 만들던 구조 그대로) | user-service, auth-service |
| V7 | payment_attempts.confirm_requested_at(승인 요청 시각) 추가 — "승인 확인 중"(CONFIRMING)과 "결제 준비만 함" 구분 | booking-service |
| V8 | rooms.total_count(객실 타입별 보유 수량), room_availabilities.booked_count(날짜별 예약 수) 추가, is_available은 "관리자 판매 중지" 의미로만 (V7은 LDP-67) | hotel-service |

payment_due_at을 실제로 채우는 로직(예약 생성 시 +30분 설정), payment_attempts/
payment_result_inbox를 실제로 쓰는 로직(토스 승인 연동, SQS 수신)은 스키마만 다루는 이
이슈 범위가 아니라 [LDP-25](https://github.com/Team-likelion-3rd-Project/likelion-devops-7th-3rd-team04/issues/37)
이후에서 구현합니다.

## 실행

- 로컬: `docker compose --profile local-infra up` 하면 `main-db-migration` 서비스가 자동 실행됩니다.
  네 서비스와 `db-seed`는 이게 성공한 뒤에 시작합니다.
- 클러스터: 이 폴더의 `Dockerfile`로 만든 메인 DB 마이그레이션 이미지를 앱 배포 전에 실행합니다
  (결제 DB의 `payment-migrations`와 같은 방식 — CI 이미지 목록·Helm hook Job 연결은 인프라 작업).
  → 반영 완료(LDP-64): CI가 `main-migrations` 이미지를 빌드하고, 차트의 `main-db-migration` hook Job이 배포 전에 적용합니다.
  dev 초기 데이터(seed.ts)는 Ansible `db.yml --tags seed`가 넣습니다 (infra/ansible/README.md 7-5).
  이미 synchronize로 테이블이 만들어진 DB에는 그대로 적용할 수 없으니, 비우고 V1부터 적용합니다.
- 적용 현황 확인: 메인 DB의 `flyway_schema_history` 테이블을 조회합니다.
