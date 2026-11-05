# E2E 테스트 (Playwright)

사용자가 화면에서 하는 행동(가입 → 예약 → 결제 → 취소, 관리자 대리 예약·취소)을 실제 브라우저로 자동 실행해 확인합니다. 오류 응답 뒤 다시 누르기, 동시에 누르기 같은 장애·중복 상황도 포함합니다.

- 로컬 전용입니다. 운영 서버에는 돌리지 않습니다 (응답을 일부러 503 등으로 바꾸는 테스트가 있습니다).
- 결제는 가짜 결제(MOCK)로만 돌립니다. 실제 토스 API를 부르지 않습니다.

## 폴더 구성

화면(frontend)과 백엔드를 함께 띄워 확인하는 테스트라 어느 한쪽에 두지 않고 저장소 맨 위 `e2e/`에 모았습니다.

```
e2e/
├── playwright.config.ts      # 테스트 설정 (화면 서버를 ../frontend 에서 5174 포트로 띄움)
├── docker-compose.e2e.yml    # 백엔드 E2E용 덮어쓰기 (결제 MOCK, 요청 한도 상향)
├── tests/                    # 시나리오와 공통 단계(helpers.ts)
└── package.json              # Playwright만 들어 있음 (frontend 의존성과 분리)
```

## 실행

모든 명령은 **`e2e/` 폴더**에서 실행합니다.

**1. 백엔드 띄우기** (처음엔 빌드로 몇 분 걸림)

```bash
docker compose -f ../backend/docker-compose.yml -f docker-compose.e2e.yml --profile local-infra up -d --build
```

`docker-compose.e2e.yml`은 E2E용 덮어쓰기입니다. 첫 번째 `-f`가 backend 쪽이라 빌드 경로와 컨테이너 이름은 평소 compose와 같습니다.

- 결제 서버를 MOCK으로 고정합니다 (`.env`가 TOSS여도).
- gateway 요청 한도를 올립니다 (테스트가 모두 localhost 한 IP에서 나가 기본 한도 1분 100회에 금방 걸리기 때문).

**2. 테스트 실행**

```bash
npm install                            # 처음 한 번
(cd ../frontend && npm install)        # 처음 한 번 (화면 서버를 띄우는 데 필요)
npx playwright install chromium        # 처음 한 번 (테스트용 브라우저)
npm test                               # 전체 실행 (약 1~2분)
npm run test:ui                        # 브라우저가 움직이는 걸 보면서 실행
npx playwright test tests/r1-duplicate-booking.spec.ts   # 파일 하나만
npm run report                         # 실패 시 스크린샷·영상·단계 기록 보기
```

화면 서버(Vite)는 테스트가 `../frontend`에서 **5174 포트**로 직접 띄웁니다. 평소 쓰는 5173과 섞이지 않습니다.

WSL에서 `missing dependencies` 오류가 나면 `sudo npx playwright install-deps chromium`을 한 번 실행합니다.

## 관리자 계정

관리자 테스트는 계정을 파일에 적지 않고 실행할 때 읽습니다.

1. 환경변수 `E2E_ADMIN_EMAIL` · `E2E_ADMIN_PASSWORD`
2. 없으면 `../backend/.env`의 `SEED_ADMIN_EMAIL` · `SEED_ADMIN_PASSWORD` (db-seed가 만든 관리자)

실패 기록(`test-results/`, `playwright-report/`)에는 입력값이 남을 수 있습니다. 둘 다 git에 올라가지 않지만, 다른 사람에게 폴더째 보내지 마세요.

## 시나리오

| 파일 | 확인하는 것 |
|---|---|
| `smoke.spec.ts` | 메인 화면이 열린다 |
| `booking-happy-path.spec.ts` | 가입 → 예약 → 결제 → 예약 확정 / 결제 후 취소 → 환불 완료 |
| `r1-duplicate-booking.spec.ts` | R1: 예약 응답이 503인데 서버는 예약을 만든 경우, 다시 누르면 예약이 1건인가 |
| `r2-stock-leak.spec.ts` | R2: 재고를 잡은 뒤 예약이 실패하면 재고가 돌아오는가 |
| `r3-last-room.spec.ts` | R3: 마지막 객실 1개를 3명이 동시에 예약하면 1명만 성공하는가 |
| `r4-r6-repeat-actions.spec.ts` | R4~R6: 결제 버튼 연타·두 탭 동시 결제·성공 화면 새로고침·취소 연타·다른 탭 재취소 |
| `r7-auto-retry.spec.ts` | R7: 429·401 뒤 자동 재전송이 중복을 만들지 않는가 |
| `admin-basic.spec.ts` | 관리자 대리 예약 → 손님 화면 결제 대기 / 직원 취소 → 손님 화면 취소 사유·환불 |

파일은 모두 `tests/`에 있고, 공통 단계(가입, 객실 선택, 예약, 결제, 관리자 로그인)는 `tests/helpers.ts`에 있습니다.

## 알려진 실패 (`test.fail`)

R1, R2는 2026-11-05 기준 **재현되는 버그**라 `test.fail(...)`로 표시해 두었습니다. 지금은 실패하는 것이 정상이며 전체 결과는 통과로 나옵니다.

| 시나리오 | 현재 결과 |
|---|---|
| R1 | 503 뒤 재클릭 → 결제 대기 예약 2건 (예약 생성에 멱등 키 없음) |
| R2 | 예약 실패 → 남은 객실 5 → 4 (재고 차감 뒤 실패해도 되돌리지 않음) |

버그가 고쳐지면 이 테스트가 **통과하면서 빨간불**이 됩니다. 그때 테스트 안의 `test.fail(...)` 줄을 지우세요.

## 참고

- 회원은 실행마다 새로 가입합니다 (`e2e-xxxxxxxx@example.com`). 로컬 DB에 테스트 회원·예약이 쌓입니다.
- 날짜는 60~260일 뒤의 1박을 무작위로 골라 실행끼리 재고가 겹치지 않게 합니다.
- 같은 DB를 쓰므로 테스트는 한 번에 하나씩 순서대로 돌립니다 (`workers: 1`).
