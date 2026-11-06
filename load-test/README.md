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
# ElastiCache Valkey 서버 인증서 검증용 (캐시 비우기 단계)
curl -fsSo /tmp/AmazonRootCA1.pem https://www.amazontrust.com/repository/AmazonRootCA1.pem
kubectl -n backend create configmap amazon-root-ca --from-file=AmazonRootCA1.pem=/tmp/AmazonRootCA1.pem \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n backend delete job loadtest-seed --ignore-not-found   # 다시 실행할 때 (Job spec 은 바꿀 수 없음)
kubectl apply -f load-test/seed/loadtest-seed-job.yaml
kubectl -n backend wait --for=condition=complete job/loadtest-seed --timeout=5m
kubectl -n backend logs job/loadtest-seed -c seed                # 객실 종류별 total_count · 사용자 수 요약
kubectl -n backend logs job/loadtest-seed -c clear-cache         # hotel-service 조회 캐시 비움: 키 N개
```

규모(호실 수 · 기간 · 사용자 수)는 Job 의 `LT_UNITS` · `LT_DAYS` · `LT_USERS` 를 고친다. 같은 날 다시 실행해도 있는 행은 건너뛴다.

SQL 을 넣은 뒤 Job 이 hotel-service 조회 캐시(Valkey `cache:hotel-service:*`, TTL 5분)를 비운다. 비우지 않으면 시드 전에 캐시된
호텔 · 객실 목록이 최대 5분 동안 그대로 보여 새 부하용 데이터가 검색되지 않는다. `clear-cache` 가 실패하면(Valkey 접속 실패 등)
Job 은 실패로 끝나지만 SQL 은 이미 반영된 상태다 — 5분 기다린 뒤 테스트하면 된다.
리프레시 토큰 · 요청 제한 키가 같은 Valkey 에 있으므로 `FLUSHDB` · `FLUSHALL` 은 쓰지 않는다.

### 로컬 (docker compose)

```bash
cd backend
{ echo "SET @lt_password_hash = '$LT_PASSWORD_HASH';"; cat ../load-test/seed/loadtest-seed.sql; } \
  | docker compose exec -T mariadb sh -c 'mariadb -u"$MARIADB_USER" -p"$MARIADB_PASSWORD" "$MARIADB_DATABASE" --table'
# hotel-service 조회 캐시 비우기 (cache:hotel-service:* 만)
docker compose exec -T redis sh -c "valkey-cli --scan --pattern 'cache:hotel-service:*' | xargs -r valkey-cli unlink"
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
| `API` | | `hotels` · `rooms` · `search` · `availability` · `booking` · `login` · `confirm` |
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

### 조회 캐시 on/off 비교

hotel-service 는 호텔 · 객실 · 편의시설 · 공지를 Valkey 에 캐시한다 (`cache:hotel-service:*`, TTL 5분). 검색 · 재고 조회는 객실 종류만
캐시에서 읽고 날짜별 재고는 매번 DB 에서 읽는다. 같은 이미지에서 `READ_CACHE_ENABLED` 로 캐시를 끄고 켜며 효과를 비교한다.

- 전제: 캐시 코드가 운영에 릴리스된 상태 (차트 revision · 이미지 태그가 커밋 SHA 고정). 시드 Job 의 `clear-cache` 가 끝난 뒤 시작한다
- 바꾸는 곳: 테스트 브랜치 `envs/prod/backend/values.yaml` 의 `services.hotel-service.env` (`THROTTLE_LIMIT` 과 같은 방식).
  ArgoCD selfHeal 이 `kubectl set env` 를 되돌리므로 반드시 커밋으로 바꾼다

| 순서 | 테스트 브랜치 값 | 확인 | 실행 |
|------|------------------|------|------|
| 1. OFF | `READ_CACHE_ENABLED: "false"` 커밋 · sync | 로그 `조회 캐시 꺼짐 (READ_CACHE_ENABLED=false)` | 1 – 2분 지난 뒤 k6, `-e NOTE=cache-off` |
| 2. ON | 위 줄 삭제(또는 `"true"`) 커밋 · sync | 로그 `조회 캐시 켜짐 — TTL 300초` | 1 – 2분 워밍업(캐시 채우기) 뒤 같은 k6, `-e NOTE=cache-on` |

```bash
kubectl -n backend logs deploy/hotel-service | grep '조회 캐시'
k6 run -e TEST=api -e API=rooms -e STAGES=50,100,150 -e NOTE=cache-off ... main.js        # ON 은 NOTE=cache-on
k6 run -e TEST=api -e API=search -e STAGES=50,100,150 -e NOTE=cache-off ... main.js
k6 run -e TEST=api -e API=availability -e STAGES=50,100,150 -e NOTE=cache-off ... main.js
```

- 두 번은 같은 `TEST` · `API` · `STAGES`(또는 `TARGET_RPS`) · hotel-service 파드 수로 연달아 돌린다. 결과 JSON 은 `NOTE` · `GITOPS_SHA` 로 구분한다
- 캐시 효과는 API 단독으로 잰다. 사용자 흐름(`tune` · `stress`)은 노드 CPU 등 다른 병목과 캐시 대상이 아닌 흐름이 섞여 효과가 묻힌다 (11-05: 노드 2대 stress 병목이 노드 CPU, hotel-service 는 그중 약 0.6코어)
- 효과가 큰 순서: `API=search`(쿼리 4 → 1) · `rooms`(3 → 0~1) · `availability`(2 → 1) · `hotels`(1 → 0), 흐름으로는 A · B. 흐름 C 는 예약 생성 때 편의시설 조회만, 흐름 D(마이페이지)는 캐시 대상이 아니다
- 값을 바꾸면 hotel-service 가 재시작되고 캐시가 빈 채로 뜬다 — 테스트 도중에 바꾸지 않고, 바꾼 직후 1 – 2분은 측정에서 뺀다
- 같은 시간 범위로 Grafana 에서 비교한다 (`service="hotel-service"`)

| 지표 | PromQL |
|------|--------|
| 처리 시간 p95 (메서드별) | `histogram_quantile(0.95, sum by (le, rpc_method) (rate(rpc_server_duration_seconds_bucket{service="hotel-service"}[1m])))` |
| 캐시 적중률 | `sum by (cache) (rate(cache_requests_total{service="hotel-service",result="hit"}[5m])) / sum by (cache) (rate(cache_requests_total{service="hotel-service"}[5m]))` |
| DB 조회 수 | `sum(rate(mysql_global_status_commands_total{command="select"}[1m]))` — 메인 DB 를 고르는 라벨은 운영 Grafana 에서 확인 |
| DB 커넥션 대기 p95 | `histogram_quantile(0.95, sum by (le) (rate(db_client_connection_wait_duration_seconds_bucket{service="hotel-service"}[1m])))` |

- `cache_requests_total` 의 `result`: `hit` 캐시 · `miss` DB 조회 후 저장 · `error` Valkey 실패로 DB 조회 · `bypass` 캐시 꺼짐. OFF 에서는 `bypass` 만 늘어야 한다
- ElastiCache(`cache.t4g.micro`) `EngineCPUUtilization` · `CurrConnections` 도 함께 본다
- 온프레미스 dev 에서 미리 볼 때는 GitLab `backend-gitops` 의 `envs/dev/values.yaml` 에 같은 키를 커밋하고, 부하는 클러스터 안에서 보낸다
  (dev api-gateway 도 `THROTTLE_LIMIT` 을 올린다)

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

## 5. 운영 부하 생성기 (`73-load-generator`)

운영 부하는 노트북이 아니라 us-east-1 의 EC2 생성기(기본 `m7a.xlarge`, EIP)에서 보낸다. 생성기 EIP 는 `80-main-edge` WAF rate limit 에서 자동으로 빠진다 (IP reputation · 관리형 규칙은 그대로). 앱 throttler(`THROTTLE_LIMIT`) · 토큰 만료는 테스트 브랜치 gitops 에서 바꾼다.

```bash
# 켜기 — 73 다음 80 (EIP 를 WAF IP set 에 넣는다). 시간당 약 $0.24 (인스턴스 + EIP)
cd infra/terraform/live/prod
AWS_PROFILE=team04 TF_VAR_enable_load_generator=true terragrunt run --all apply \
  --filter './73-load-generator' --filter './80-main-edge'
AWS_PROFILE=team04 aws wafv2 get-ip-set --scope REGIONAL --name team04-hotel-main-rate-limit-exempt \
  --id "$(AWS_PROFILE=team04 aws wafv2 list-ip-sets --scope REGIONAL --query "IPSets[?Name=='team04-hotel-main-rate-limit-exempt'].Id" --output text)" \
  --query 'IPSet.Addresses'                                   # 생성기 EIP /32

# 접속 (인바운드 없음, Session Manager)
AWS_PROFILE=team04 aws ssm start-session --target "$(cd 73-load-generator && AWS_PROFILE=team04 terragrunt output -raw instance_id)"
```

생성기 안에서:

```bash
test -f /etc/load-generator/ready || sudo tail -50 /var/log/cloud-init-output.log   # 부트스트랩 확인 (부팅 후 몇 분)
sudo -iu loadtest
cd repo && git pull && cd load-test/k6        # 부팅 때 main 의 load-test/ 만 받는다. 다른 브랜치는 git fetch origin <브랜치> && git checkout FETCH_HEAD
ulimit -n                                     # 250000
export LT_PASSWORD='<테스트 사용자 비밀번호>'   # 3절 명령에 그대로 쓴다
k6 run -e TEST=smoke -e BASE_URL=https://api.<운영 도메인> ... main.js

# 결과 보존 — 10-global 로그 버킷 load-test/<날짜>/ (Object Lock 보존 기간 동안 지워지지 않음)
set -a; . /etc/load-generator/config.env; set +a
aws s3 cp result/ "s3://$RESULT_BUCKET/${RESULT_PREFIX}$(date -u +%F)/" --recursive --exclude .gitkeep
```


Prometheus 지표는 destroy 하면 사라진다 (저장소 emptyDir). **destroy 전에 노트북에서** 테스트 구간 지표를 내려받아 같은 버킷 `load-test/<날짜>/prometheus/` 에 올린다:

```bash
load-test/scripts/export-prometheus.sh 2026-11-04T01:30:00Z                 # 시작(UTC) ~ 지금
load-test/scripts/export-prometheus.sh <시작 UTC> <끝 UTC> <이름>            # 구간을 나눌 때
```

- **테스트 날은 `run --all apply` · `73` apply 마다 `TF_VAR_enable_load_generator=true` 를 같이 준다.** 빼고 apply 하면 테스트 중에 생성기 · EIP 가 삭제되고 WAF 예외도 비워진다. 터미널에 export 해 두는 것을 권장한다
- 노드 수: 평소 2대, Cluster Autoscaler 가 Pending Pod 를 보고 최대 4대까지 늘린다 (`72` `node_min_size` ~ `node_max_size`). `node_desired_size` 는 노드 그룹을 처음 만들 때만 쓰이고 이후 apply 는 노드 수를 바꾸지 않는다 (`ignore_changes`)
- 노드 수를 고정해야 하는 측정은 `72` 를 `TF_VAR_node_min_size=N TF_VAR_node_max_size=N` 으로 apply 한다. **노드 수가 바뀌면 그 위의 Pod 가 옮겨지고, Prometheus 가 옮겨지면 그날 지표가 사라진다** (저장소 emptyDir). 바꾸기 전에 Grafana 스냅샷 · 필요한 지표를 먼저 남긴다
- 기준선은 평소 구성(노드 2대 · main values)에서 먼저 잰다. 노드 4대 고정 결과는 피크 상한으로만 쓴다
- 결제는 테스트 브랜치로 바뀌지 않는다. 결제 서버는 SSM `/team04-hotel/prod/payment/release` 를 읽고, 이 파라미터는 gitops main 이 바뀔 때만 갱신된다. 테스트 시작 전 `PAYMENT_PROVIDER` 를 `MOCK` 으로 바꾸고(k6 의 mock 결제 키는 TOSS 에서 전부 거절됨), **끝나면 `TOSS` 로 되돌린다** (`11-registry` 소속이라 destroy 해도 남는다)
- 하루 테스트로 가까운 날짜(14일 이내) 재고가 빠르게 찬다 (11-04: stress · load 7회에 81%). 매진 비율이 1% 를 넘으면 결과가 무효이므로 측정 사이에 확인한다

- 생성기 CPU · 메모리는 테스트 중에 `top` 으로 본다. `dropped_iterations > 0` 인데 생성기 CPU 가 80% 를 넘으면 생성기 부족이다 → `instance_type` 을 올린다 (버스터블 t* 는 쓰지 않는다)
- 생성기를 다시 만들면(`instance_type` 변경 등) 인스턴스는 교체되지만 EIP 는 그대로라 `80` 을 다시 apply 할 필요가 없다. 켜고 끌 때만 `80` 도 apply 한다
- 끄기: 위 명령에서 `TF_VAR_enable_load_generator` 를 빼고 다시 실행 (인스턴스 · EIP 삭제, WAF 예외 비움). 매일 destroy 에도 포함된다. 결과를 올리기 전에 끄면 결과 파일도 사라진다
