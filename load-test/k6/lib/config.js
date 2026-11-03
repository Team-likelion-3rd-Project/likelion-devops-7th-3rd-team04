// 실행 설정 (LDP-196, 위키 「성능 테스트」). 모든 값은 -e 로 바꾼다 — 튜닝 반복 중 스크립트는 고치지 않는다.
//
// 워크로드(흐름 비율 · 생각 시간 · 날짜 분포)는 모든 테스트에서 같게 둔다. 바꾸면 같은 날 결과끼리도 비교할 수 없다.

const env = __ENV;

function num(name, fallback) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} 는 숫자여야 합니다: ${raw}`);
  return value;
}

function list(name, fallback) {
  const raw = env[name];
  if (!raw) return fallback;
  return raw.split(',').map((v) => {
    const value = Number(v.trim());
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 는 양수 목록이어야 합니다: ${raw}`);
    return value;
  });
}

export const BASE_URL = (env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
export const TEST = env.TEST || 'smoke';

// 흐름 정의 — requests: 흐름 1회의 요청 수 (요청/초 → 흐름 시작 rate 환산에 사용)
// 챗봇은 범위 제외 (라우트 rate limit 고정 · Vertex AI 지연 · 비용)
export const FLOWS = {
  browse: { requests: 4, ratio: 0.65 }, // A. 둘러보기 (비회원)
  search: { requests: 2, ratio: 0.15 }, // B. 검색
  booking: { requests: 5, ratio: 0.1 }, // C. 예약과 결제
  mypage: { requests: 2, ratio: 0.1 }, // D. 내 예약 확인
};

// 흐름 1회 평균 요청 수 (현재 비율 기준 3.6)
export const AVG_REQUESTS = Object.values(FLOWS).reduce((sum, f) => sum + f.requests * f.ratio, 0);

// 화면 사이 생각 시간 (초)
export const THINK_MIN = num('THINK_MIN', 1);
export const THINK_MAX = num('THINK_MAX', 3);

// 목표 부하 (ALB 요청/초)
export const TARGET_RPS = num('TARGET_RPS', 100);
// tune 단계 (ALB 요청/초) — 1일차 한계 테스트 결과의 한계 앞뒤로 정한다
export const STAGES = list('STAGES', [50, 100, 150]);
// tune 단계 하나의 길이 (초). 기본 3단계 × 100초 = 5분
export const STAGE_SECONDS = num('STAGE_SECONDS', 100);

// API 단독 (TEST=api, 또는 TEST=tune 에 붙여 병목 API 만): hotels | availability | booking | login | confirm
export const API = env.API || '';

// 테스트별 부하 형태 (위키 「테스트 유형」)
export const LOAD_MINUTES = num('LOAD_MINUTES', 15); // 부하 판정 유지 시간
export const STRESS_START = num('STRESS_START', 50); // 한계: 시작 · 증가폭 · 상한 (요청/초), 단계 길이(초)
export const STRESS_STEP = num('STRESS_STEP', 50);
export const STRESS_MAX = num('STRESS_MAX', 500);
export const STRESS_STEP_SECONDS = num('STRESS_STEP_SECONDS', 120);
export const SPIKE_BASE_RPS = num('SPIKE_BASE_RPS', 50); // 스파이크: 평상 부하 × 배수, 유지 시간(분)
export const SPIKE_FACTOR = num('SPIKE_FACTOR', 5);
export const SPIKE_HOLD_MINUTES = num('SPIKE_HOLD_MINUTES', 5);
export const FAULT_MINUTES = num('FAULT_MINUTES', 30); // 장애 주입: 목표 부하 유지 시간
export const SOAK_RATIO = num('SOAK_RATIO', 0.7); // 내구성: 목표 부하 비율, 유지 시간(분)
export const SOAK_MINUTES = num('SOAK_MINUTES', 45);

// 날짜 분포 — NEAR_RATIO 는 오늘 + 1 ~ NEAR_DAYS 일 안에서 체크인, 나머지는 FAR_DAYS 일 안에서.
// 객실 종류 × 날짜 행에 비관적 락이 걸리므로 가까운 날짜에 몰아야 실제 같은 경합이 생긴다
export const NEAR_RATIO = num('NEAR_RATIO', 0.6);
export const NEAR_DAYS = num('NEAR_DAYS', 14);
export const FAR_DAYS = num('FAR_DAYS', 300);
export const MAX_NIGHTS = num('MAX_NIGHTS', 3);

// 테스트 사용자 (loadtest-seed.sql 과 같은 규칙). 비밀번호는 레포에 두지 않는다
export const LT_USERS = num('LT_USERS', 500);
export const LT_PASSWORD = env.LT_PASSWORD || '';
export const LOGIN_BATCH = num('LOGIN_BATCH', 10); // setup() 로그인 동시 요청 수 (bcrypt 라 낮게)

// 부하용 호텔 이름 접두사 · 동시 예약 전용 객실 (loadtest-seed.sql)
export const LOAD_HOTEL_PREFIX = '부하테스트';
export const CONCURRENCY_ROOM_NAME = '동시예약 전용룸';

// 예약 확정(RESERVED) 지연 표본 비율 — 재조회가 ALB 요청을 늘리므로 일부만 잰다
export const CONFIRM_LAG_SAMPLE = num('CONFIRM_LAG_SAMPLE', 0.1);
export const CONFIRM_LAG_POLL_SECONDS = num('CONFIRM_LAG_POLL_SECONDS', 0.5);
export const CONFIRM_LAG_MAX_POLLS = num('CONFIRM_LAG_MAX_POLLS', 20);

// 결과 기록용 (위키 「결과 보존」)
export const META = {
  gitopsSha: env.GITOPS_SHA || '',
  k6Sha: env.K6_SHA || '',
  note: env.NOTE || '',
};
// 결과 JSON 위치 — 기본은 실행 위치와 상관없이 load-test/k6/result (handleSummary 경로는 cwd 기준이라 절대 경로로 바꿈).
// k6 는 디렉터리를 만들지 않으므로 result/.gitkeep 으로 디렉터리를 유지한다. RESULT_DIR 로 바꾸면 미리 만들어 둔다
const DEFAULT_RESULT_DIR = decodeURI(import.meta.resolve('../result')).replace(/^file:\/\//, '');
export const RESULT_DIR = (env.RESULT_DIR || DEFAULT_RESULT_DIR).replace(/\/$/, '');
