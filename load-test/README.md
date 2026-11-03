# 부하 테스트 (k6)

설계 · 테스트 유형 · 일정 · 판정 기준은 위키 「성능 테스트」에 있다. 여기에는 실행 방법만 둔다.

```
load-test/
├── seed/
│   ├── loadtest-seed.sql        # 부하용 호텔 · 호실 · 예약 가능일 · 테스트 사용자 (멱등)
│   └── loadtest-seed-job.yaml   # 운영 클러스터에서 위 SQL 을 실행하는 일회성 Job
└── k6/
    ├── main.js                  # 진입점 (-e TEST= 로 테스트 유형 선택)
    ├── concurrency.js           # 동시 예약 (테스트 4)
    ├── lib/                     # 설정 · HTTP 태그 · 데이터 선택 · setup · 지표 · 결과 기록
    ├── flows/                   # A browse · B search · C booking · D mypage · API 단독(api.js)
    ├── profiles/                # 테스트 유형별 부하 형태 · thresholds
    └── result/                  # 실행 결과 JSON (커밋하지 않음)
```

## 1. 테스트 사용자 비밀번호

레포가 공개라 비밀번호와 해시는 커밋하지 않는다. 테스트 날마다 정해서 시드(해시)와 k6(원문)에 같이 쓴다.

```bash
export LT_PASSWORD='<테스트 사용자 비밀번호, 8자 이상>'
# 앱과 같은 bcrypt 라이브러리로 해시 (cost 10)
export LT_PASSWORD_HASH=$(cd backend && node -e "console.log(require('bcrypt').hashSync(process.env.LT_PASSWORD, 10))")
```

## 2. 테스트 데이터 시드

### 운영 (테스트 날, 재생성 → 테스트 브랜치 전환 다음)

```bash
kubectl -n backend create configmap loadtest-seed-sql --from-file=load-test/seed/loadtest-seed.sql \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n backend create secret generic loadtest-seed --from-literal=LT_PASSWORD_HASH="$LT_PASSWORD_HASH" \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n backend delete job loadtest-seed --ignore-not-found   # 다시 실행할 때 (Job spec 은 바꿀 수 없음)
kubectl apply -f load-test/seed/loadtest-seed-job.yaml
kubectl -n backend wait --for=condition=complete job/loadtest-seed --timeout=5m
kubectl -n backend logs job/loadtest-seed                        # 객실 종류별 total_count · 사용자 수 요약
```

규모(호실 수 · 기간 · 사용자 수)는 Job 의 `LT_UNITS` · `LT_DAYS` · `LT_USERS` 를 고친다. 같은 날 다시 실행해도 있는 행은 건너뛴다.

### 로컬 (docker compose)

```bash
cd backend
{ echo "SET @lt_password_hash = '$LT_PASSWORD_HASH';"; cat ../load-test/seed/loadtest-seed.sql; } \
  | docker compose exec -T mariadb sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" --table'
```

SQL 은 컬럼 이름이 고정이라 스키마(backend/migrations)가 바뀌면 같이 고친다. 운영 RDS(MariaDB 11.8)와 로컬(11.2)의 기본 collation 이 다르니, SQL 을 고치면 11.8 에서도 한 번 실행해 본다.

## 3. k6 실행

```bash
cd load-test/k6
k6 run -e TEST=smoke -e BASE_URL=https://<운영 도메인> -e LT_PASSWORD="$LT_PASSWORD" \
  -e GITOPS_SHA=<테스트 브랜치 커밋> -e K6_SHA=$(git rev-parse --short HEAD) main.js
```

| TEST | 위키 | 부하 형태 | 판정 |
|------|------|-----------|------|
| `smoke` | S | 흐름마다 3회, 사용자 5명. **매일 첫 실행** | check 100%, 에러 0, 예약 확정까지 전부 |
| `tune` | T | `STAGES` 단계 × `STAGE_SECONDS` (사용자 흐름, `API` 를 주면 그 API 만). 그날 첫 tune 이 기준 | 에러율 5% 자동 중단 |
| `api` | 1 | `API` 하나를 `STAGES` 단계로 (생각 시간 없음) | 에러율 5% 자동 중단 |
| `load` | 2 | 1분 상승 → `TARGET_RPS` 를 `LOAD_MINUTES` 유지 | **SLO** (read p95 < 300ms, write p95 < 1s, 에러율 < 1%) |
| `stress` | 3 | `STRESS_START` 부터 `STRESS_STEP` 씩 `STRESS_STEP_SECONDS` 마다 상향 | 에러율 5% 자동 중단 = 한계점 |
| `spike` | 5 | 평상 `SPIKE_BASE_RPS` 2분 → 10초 만에 `SPIKE_FACTOR` 배 → `SPIKE_HOLD_MINUTES` 유지 → 평상 3분 | 에러율 < 1% (Pod 확장 시점은 Grafana) |
| `fault` | 7 | `TARGET_RPS` 를 `FAULT_MINUTES` 유지. 실행 중 장애를 하나씩 넣는다 | **자동 중단 없음**. 복구 시간은 `--out csv` 시계열 · ALB · Grafana |
| `soak` | 8 | `TARGET_RPS × SOAK_RATIO` 를 `SOAK_MINUTES` 유지 | SLO 유지 (누수 · 적체 추이는 Grafana) |

모든 프로필 공통: `dropped_iterations == 0`(부하 생성기 부족이면 무효, stress 제외), `booking_sold_out < 1%`, `payment_not_approved < 1%`.

```bash
k6 run -e TEST=api -e API=booking -e STAGES=20,40,80 ... main.js     # API 단독
k6 run -e TEST=tune -e STAGES=40,60,80 ... main.js                    # 1일차 한계 앞뒤로
k6 run -e TEST=fault --out csv=result/fault-$(date -u +%H%M).csv.gz ... main.js   # 장애 주입 (시계열, k6 디렉터리에서 실행)
```

| env | 기본값 | 설명 |
|-----|--------|------|
| `BASE_URL` | `http://localhost:3000` | ALB(또는 api-gateway) 주소 |
| `LT_PASSWORD` | (필수) | 테스트 사용자 비밀번호 |
| `TARGET_RPS` | `100` | 목표 부하 (ALB 요청/초). load · fault · soak |
| `STAGES` | `50,100,150` | tune · api 단계 (요청/초). 1일차 한계 앞뒤로 |
| `STAGE_SECONDS` | `100` | tune · api 단계 길이 (초, 앞 15초는 상승) |
| `API` | | `hotels` · `availability` · `booking` · `login` · `confirm` |
| `LOAD_MINUTES` | `15` | load 유지 시간 |
| `STRESS_START` · `STRESS_STEP` · `STRESS_MAX` · `STRESS_STEP_SECONDS` | `50` · `50` · `500` · `120` | stress 단계 |
| `SPIKE_BASE_RPS` · `SPIKE_FACTOR` · `SPIKE_HOLD_MINUTES` | `50` · `5` · `5` | spike |
| `FAULT_MINUTES` | `30` | fault 유지 시간 |
| `SOAK_RATIO` · `SOAK_MINUTES` | `0.7` · `45` | soak |
| `LT_USERS` | `500` | setup 에서 로그인할 테스트 사용자 수 (시드와 같게) |
| `LOGIN_BATCH` | `10` | setup 로그인 동시 요청 수 |
| `CONFIRM_LAG_SAMPLE` | `0.1` | 예약 확정 지연을 재는 흐름 C 비율 (smoke 는 1) |
| `THINK_MIN` · `THINK_MAX` | `1` · `3` | 화면 사이 생각 시간 (초) — **워크로드라 바꾸지 않는다** |
| `NEAR_RATIO` · `NEAR_DAYS` · `FAR_DAYS` · `MAX_NIGHTS` | `0.6` · `14` · `300` · `3` | 날짜 분포 — **워크로드라 바꾸지 않는다** |
| `GITOPS_SHA` · `K6_SHA` · `NOTE` | | 결과 파일 meta 에 기록 |
| `RESULT_DIR` | `k6/result` | 결과 JSON 위치. 기본값은 실행 위치와 상관없이 `k6/result` (다른 곳이면 미리 생성 — k6 가 디렉터리를 만들지 않음) |

- 요청 태그: `name`(경로 묶음), `kind` = `read`(흐름 A · B · D) · `write`(흐름 C) · `poll`(확정 지연 재조회) · `setup`
- 결과: 터미널 요약 + `k6/result/<TEST>-<종료 시각>.json` (meta · 판정 · 지표). 토큰은 남기지 않는다. setup 이 실패하면 판정은 실패
- 판정 실패 시 k6 종료 코드가 0 이 아니다. 에러율 5% 를 넘으면 자동 중단
- `booking_sold_out` 이 1% 를 넘으면 서버가 아니라 데이터 부족이다 — 시드 `LT_UNITS` 를 늘린다
- 예약 생성은 지금 api-gateway 가 실패를 전부 404 로 돌려준다 (매진 · 없는 객실 · 서비스 장애). 매진 문구의 404 만 매진, 나머지는 `booking_create_error`(SLO < 1%, 5% 자동 중단). 백엔드가 매진 409 · 장애 503 으로 바꾸면 409 도 매진으로 받는다 (`lib/booking-result.js`)
- 토큰 만료 전에 끝나지 않을 테스트는 setup 에서 실패한다 (테스트 브랜치 `JWT_ACCESS_EXPIRES_IN`)
- `API=booking` · `confirm` 은 재고를 빠르게 쓴다 (booking 은 결제하지 않아 결제 마감까지 재고를 잡음). 단계를 낮게 시작한다
- `API=confirm` 의 rate 는 확정 요청 기준이고, 이터레이션마다 준비 요청(예약 생성 · 결제 준비, `kind: prep`)이 2건 더 나간다
- stress 상한 500 요청/초에서 VU 가 최대 약 3,500 개까지 늘 수 있다 — 부하 생성기 메모리 확인

## 4. 동시 예약 (테스트 4)

```bash
cd load-test/k6
k6 run -e BASE_URL=https://<운영 도메인> -e LT_PASSWORD="$LT_PASSWORD" concurrency.js
```

- 「동시예약 전용룸」(재고 1)에서 남은 방이 1개인 가장 가까운 날짜를 골라, 서로 다른 사용자 `CONC_USERS`(기본 100)명이 같은 순간 1박 예약
- 판정: 성공 정확히 1건, 201 · 404 외 응답 0건, 사후 조회에서 남은 방 0
- 성공한 예약은 결제 마감까지 재고를 잡으므로 다시 실행하면 자동으로 다음 날짜를 쓴다
- DB 교차 확인 (`booked_count` = 활성 예약 수 = 1):

```sql
SELECT rt.name, a.date, rt.total_count, a.booked_count,
       (SELECT COUNT(*) FROM reservations r
         WHERE r.room_type_id = rt.room_type_id AND r.check_in_date <= a.date AND r.check_out_date > a.date
           AND r.status IN ('PENDING_PAYMENT', 'RESERVED')) AS active_reservations
FROM room_types rt JOIN room_availabilities a ON a.room_type_id = rt.room_type_id
WHERE rt.name = '동시예약 전용룸' AND a.booked_count > 0 ORDER BY a.date;
```

로컬에서는 부하를 주지 않는다 (smoke · `k6 inspect` · 아주 낮은 단계 확인만). 기본 rate limit(IP당 분당 100회) 안에서 끝나야 한다.
