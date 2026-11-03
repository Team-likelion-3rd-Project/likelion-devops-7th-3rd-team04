// 테스트 유형별 부하 형태 · 판정 기준 (위키 「테스트 유형」)
// 워크로드(흐름 · 비율 · 생각 시간)는 공통이고, 여기서는 부하 형태와 thresholds 만 정한다.
import {
  FLOWS,
  AVG_REQUESTS,
  THINK_MIN,
  THINK_MAX,
  TARGET_RPS,
  STAGES,
  STAGE_SECONDS,
  LT_USERS,
  API,
  LOAD_MINUTES,
  STRESS_START,
  STRESS_STEP,
  STRESS_MAX,
  STRESS_STEP_SECONDS,
  SPIKE_BASE_RPS,
  SPIKE_FACTOR,
  SPIKE_HOLD_MINUTES,
  FAULT_MINUTES,
  SOAK_RATIO,
  SOAK_MINUTES,
} from '../lib/config.js';
import { APIS } from '../flows/api.js';

const RAMP_SECONDS = 15;

// ---- 부하 형태: 요청/초 기준 stages → 흐름별 ramping-arrival-rate ----

// ALB 요청/초 → 흐름 시작 rate (회/분, 정수). 흐름마다 요청 수가 달라 비율과 평균 요청 수로 나눈다
function flowPerMinute(flow, rps) {
  return Math.round((rps / AVG_REQUESTS) * FLOWS[flow].ratio * 60);
}

// 리틀의 법칙: 동시 진행 흐름 수 ≈ 시작 rate × 흐름 1회 소요 시간 (생각 시간 + 응답 0.5초 가정).
// 부하가 한계에 가까우면 응답이 느려져 VU 가 더 필요하므로 상한은 넉넉히
function flowVUs(flow, peakRps) {
  const f = FLOWS[flow];
  const seconds = (f.requests - 1) * ((THINK_MIN + THINK_MAX) / 2) + f.requests * 0.5;
  const pre = Math.ceil((flowPerMinute(flow, peakRps) / 60) * seconds * 1.2) + 1;
  return { preAllocatedVUs: pre, maxVUs: Math.max(pre * 3, 10) };
}

// stages: [{ rps, seconds }] — 각 구간 끝의 목표 요청/초까지 선형 변화
function userFlowScenarios(stages) {
  const peak = Math.max(...stages.map((s) => s.rps));
  const out = {};
  for (const flow of Object.keys(FLOWS)) {
    out[flow] = Object.assign(
      {
        executor: 'ramping-arrival-rate',
        exec: flow,
        startRate: 0,
        timeUnit: '1m',
        stages: stages.map((s) => ({ target: flowPerMinute(flow, s.rps), duration: `${s.seconds}s` })),
      },
      flowVUs(flow, peak),
    );
  }
  return out;
}

// API 단독 — 이터레이션 1회 = 측정 대상 요청 1건 (confirm 은 준비 요청 2건 포함)
function apiScenarios(stages) {
  const api = APIS[API];
  if (!api) throw new Error(`API 를 지정하세요: ${Object.keys(APIS).join(' | ')} (지금: "${API}")`);
  const peak = Math.max(...stages.map((s) => s.rps));
  const pre = Math.ceil(peak * api.requests * 0.5 * 1.2) + 1;
  return {
    [`api_${API}`]: {
      executor: 'ramping-arrival-rate',
      exec: api.exec,
      startRate: 0,
      timeUnit: '1m',
      stages: stages.map((s) => ({ target: Math.round(s.rps * 60), duration: `${s.seconds}s` })),
      preAllocatedVUs: pre,
      maxVUs: Math.max(pre * 5, 20),
    },
  };
}

// 계단: 각 단계 RAMP_SECONDS 상승 후 유지
function steps(rpsList, stepSeconds) {
  return rpsList.flatMap((rps) => [
    { rps, seconds: RAMP_SECONDS },
    { rps, seconds: stepSeconds - RAMP_SECONDS },
  ]);
}

function totalSeconds(stages) {
  return stages.reduce((sum, s) => sum + s.seconds, 0);
}

// ---- 판정 ----

// 에러율 5% 면 자동 중단 (위키 중단 기준)
const ABORT = { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '30s' };

// 공통 — 부하 생성기가 목표 rate 를 못 내면 무효, 재고 부족이 많으면 데이터 부족으로 무효
const VALIDITY = {
  dropped_iterations: ['count==0'],
  booking_sold_out: ['rate<0.01'], // 넘으면 시드 LT_UNITS 를 늘린다
  payment_not_approved: ['rate<0.01'],
};

// 결과 요약에 kind · 흐름별 수치를 남기려고 판정 없는 submetric 을 같이 만든다
const BREAKDOWN = {
  'http_req_duration{kind:read}': ['max>=0'],
  'http_req_duration{kind:write}': ['max>=0'],
  'http_req_failed{kind:read}': ['rate>=0'],
  'http_req_failed{kind:write}': ['rate>=0'],
  'http_reqs{kind:read}': ['count>=0'],
  'http_reqs{kind:write}': ['count>=0'],
  // 예약 생성은 404 · 409 를 예상 응답으로 빼므로(매진) 에러는 이 지표로 본다 (lib/booking-result.js)
  booking_create_error: ['rate>=0'],
};
for (const flow of Object.keys(FLOWS)) BREAKDOWN[`http_req_duration{scenario:${flow}}`] = ['max>=0'];

// 위키 SLO — 조회(A · B · D) p95 < 300ms, 예약 · 결제(C) p95 < 1s, 에러율 < 1%
const SLO = {
  'http_req_duration{kind:read}': ['p(95)<300'],
  'http_req_duration{kind:write}': ['p(95)<1000'],
  'http_req_failed{kind:read}': ['rate<0.01', ABORT],
  'http_req_failed{kind:write}': ['rate<0.01', ABORT],
  booking_create_error: ['rate<0.01', ABORT],
};

const ABORT_ON_ERRORS = {
  'http_req_failed{kind:read}': [ABORT],
  'http_req_failed{kind:write}': [ABORT],
  booking_create_error: [ABORT],
};

function thresholds(...parts) {
  return Object.assign({}, BREAKDOWN, ...parts);
}

// 사용자 흐름 · API 단독 공통 결과
function shaped(stages, extra) {
  const out = Object.assign(
    {
      scenarios: API ? apiScenarios(stages) : userFlowScenarios(stages),
      durationSeconds: totalSeconds(stages),
      loginUsers: LT_USERS,
      shape: { api: API || null, stages },
    },
    extra,
  );
  if (API) out.thresholds[`http_req_duration{scenario:api_${API}}`] = ['max>=0'];
  return out;
}

// ---- 프로필 ----

const profiles = {
  // S. 설정 확인 (측정 아님) — 흐름마다 3회, 예약 확정까지 전부 확인
  smoke: () => ({
    scenarios: Object.fromEntries(
      Object.keys(FLOWS).map((flow) => [flow, { executor: 'shared-iterations', exec: flow, vus: 1, iterations: 3, maxDuration: '2m' }]),
    ),
    thresholds: thresholds({
      checks: ['rate==1'],
      'http_req_failed{kind:read}': ['rate==0'],
      'http_req_failed{kind:write}': ['rate==0'],
      booking_create_error: ['rate==0'],
      booking_confirm_timeout: ['count==0'],
    }),
    durationSeconds: 120,
    loginUsers: 5,
    confirmLagSample: 1,
    shape: { iterationsPerFlow: 3 },
  }),

  // T. 튜닝 반복 — 부하 판정과 같은 흐름을 STAGES 3단계로 짧게. 그날 첫 tune = 그날 기준. -e API= 면 그 API 만
  tune: () => shaped(steps(STAGES, STAGE_SECONDS), { thresholds: thresholds(ABORT_ON_ERRORS, VALIDITY) }),

  // 1. API 기준선 — API 하나를 STAGES 로 단계 증가 (-e API= 필수)
  api: () => {
    if (!API) throw new Error('TEST=api 는 -e API= 가 필요합니다');
    return shaped(steps(STAGES, STAGE_SECONDS), { thresholds: thresholds(ABORT_ON_ERRORS, VALIDITY) });
  },

  // 2. 부하 판정 — 1분 상승 후 TARGET_RPS 를 LOAD_MINUTES 유지, SLO 판정
  load: () =>
    shaped(
      [
        { rps: TARGET_RPS, seconds: 60 },
        { rps: TARGET_RPS, seconds: LOAD_MINUTES * 60 },
      ],
      { thresholds: thresholds(SLO, VALIDITY) },
    ),

  // 3. 한계 — STRESS_START 부터 STRESS_STEP 씩 STRESS_STEP_SECONDS 마다 상향. 에러율 5% 에서 자동 중단 = 한계점
  stress: () => {
    const rpsList = [];
    for (let rps = STRESS_START; rps <= STRESS_MAX; rps += STRESS_STEP) rpsList.push(rps);
    // 한계 탐색이라 SLO · dropped 는 판정하지 않는다 (VU 부족도 결과로 본다)
    return shaped(steps(rpsList, STRESS_STEP_SECONDS), { thresholds: thresholds(ABORT_ON_ERRORS, { booking_sold_out: ['rate<0.01'] }) });
  },

  // 5. 스파이크 — 평상 2분 → 10초 만에 SPIKE_FACTOR 배 → 유지 → 평상 3분. Pod 확장 시점은 Grafana 로 본다
  spike: () => {
    const peak = SPIKE_BASE_RPS * SPIKE_FACTOR;
    return shaped(
      [
        { rps: SPIKE_BASE_RPS, seconds: 30 },
        { rps: SPIKE_BASE_RPS, seconds: 90 },
        { rps: peak, seconds: 10 },
        { rps: peak, seconds: SPIKE_HOLD_MINUTES * 60 },
        { rps: SPIKE_BASE_RPS, seconds: 10 },
        { rps: SPIKE_BASE_RPS, seconds: 180 },
      ],
      // 위키 합격 기준: 확장 중 에러율 1% 미만
      {
        thresholds: thresholds(VALIDITY, {
          'http_req_failed{kind:read}': ['rate<0.01', ABORT],
          'http_req_failed{kind:write}': ['rate<0.01', ABORT],
          booking_create_error: ['rate<0.01', ABORT],
        }),
      },
    );
  },

  // 7. 부하 중 장애 주입 — TARGET_RPS 유지. 장애를 일부러 넣으므로 자동 중단하지 않는다.
  //    복구 시간은 시계열이 필요하다: k6 run --out csv=<파일> 과 ALB · Grafana 로 본다
  fault: () =>
    shaped(
      [
        { rps: TARGET_RPS, seconds: 60 },
        { rps: TARGET_RPS, seconds: FAULT_MINUTES * 60 },
      ],
      { thresholds: thresholds(VALIDITY) },
    ),

  // 8. 내구성 — 목표의 SOAK_RATIO 를 SOAK_MINUTES 유지. 판정은 메모리 · 커넥션 · 큐 추이(Grafana)가 주, k6 는 SLO 유지 여부
  soak: () =>
    shaped(
      [
        { rps: TARGET_RPS * SOAK_RATIO, seconds: 60 },
        { rps: TARGET_RPS * SOAK_RATIO, seconds: SOAK_MINUTES * 60 },
      ],
      { thresholds: thresholds(SLO, VALIDITY) },
    ),
};

export function buildProfile(test) {
  const make = profiles[test];
  if (!make) throw new Error(`알 수 없는 TEST: ${test} (가능: ${Object.keys(profiles).join(', ')})`);
  return make();
}
