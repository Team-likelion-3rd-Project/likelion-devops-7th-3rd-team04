// handleSummary — 실행마다 결과 JSON 을 남긴다 (위키 「결과 보존」: 운영은 매일 destroy 라 Prometheus 가 사라짐)
// setup_data 에는 토큰이 들어 있으므로 결과 파일에 넣지 않는다.
import { BASE_URL, TEST, FLOWS, AVG_REQUESTS, THINK_MIN, THINK_MAX, NEAR_RATIO, NEAR_DAYS, FAR_DAYS, MAX_NIGHTS, TARGET_RPS, META, RESULT_DIR } from './config.js';

function v(data, name, stat) {
  const m = data.metrics[name];
  return m && m.values && m.values[stat] !== undefined ? m.values[stat] : null;
}

function ms(x) {
  return x === null ? '-' : `${x.toFixed(0)}ms`;
}

function pct(x) {
  return x === null ? '-' : `${(x * 100).toFixed(2)}%`;
}

function failedThresholds(data) {
  const out = [];
  // setup 이 실패하면 흐름이 하나도 돌지 않아 threshold 가 전부 통과로 보인다
  if (!data.setup_data) out.push('setup 실패 (위 오류 확인)');
  else if (!v(data, 'iterations', 'count')) out.push('실행된 흐름 없음');
  for (const [name, m] of Object.entries(data.metrics)) {
    for (const [expr, t] of Object.entries(m.thresholds || {})) {
      if (!t.ok) out.push(`${name}: ${expr}`);
    }
  }
  return out;
}

function text(data, meta, failed) {
  const lines = [
    `[${meta.test}] ${meta.startedAt} ~ ${meta.endedAt} (UTC)  ${meta.baseUrl}`,
    `  요청       : ${v(data, 'http_reqs', 'count')}건, ${(v(data, 'http_reqs', 'rate') || 0).toFixed(1)}/s`,
    `  read  p95  : ${ms(v(data, 'http_req_duration{kind:read}', 'p(95)'))}   에러율 ${pct(v(data, 'http_req_failed{kind:read}', 'rate'))}`,
    `  write p95  : ${ms(v(data, 'http_req_duration{kind:write}', 'p(95)'))}   에러율 ${pct(v(data, 'http_req_failed{kind:write}', 'rate'))}`,
  ];
  // 흐름별(사용자 흐름) 또는 API 단독 시나리오 — 실제로 돈 시나리오만
  for (const name of Object.keys(data.metrics).filter((k) => k.startsWith('http_req_duration{scenario:')).sort()) {
    if (!v(data, name, 'count')) continue;
    const scenario = name.slice('http_req_duration{scenario:'.length, -1);
    lines.push(`  ${scenario.padEnd(10)} : p95 ${ms(v(data, name, 'p(95)'))}`);
  }
  lines.push(
    `  checks     : ${pct(v(data, 'checks', 'rate'))}`,
    `  매진 비율  : ${pct(v(data, 'booking_sold_out', 'rate'))}   예약 생성 에러 ${pct(v(data, 'booking_create_error', 'rate'))}   결제 미승인 ${pct(v(data, 'payment_not_approved', 'rate'))}`,
    `  확정 지연  : p95 ${ms(v(data, 'booking_confirm_lag', 'p(95)'))}  (표본 ${v(data, 'booking_confirm_lag', 'count') || 0}건, 시간 초과 ${v(data, 'booking_confirm_timeout', 'count') || 0}건)`,
    `  dropped    : ${v(data, 'dropped_iterations', 'count') || 0}`,
  );
  if (data.metrics.concurrency_success || data.metrics.concurrency_sold_out) {
    lines.push(
      `  동시 예약  : 성공 ${v(data, 'concurrency_success', 'count') || 0}  매진 ${v(data, 'concurrency_sold_out', 'count') || 0}  기타 ${v(data, 'concurrency_unexpected', 'count') || 0}` +
        `  (예약 p95 ${ms(v(data, 'http_req_duration{name:POST /bookings}', 'p(95)'))}, max ${ms(v(data, 'http_req_duration{name:POST /bookings}', 'max'))})`,
    );
  }
  lines.push(
    failed.length === 0 ? '  판정       : 통과' : `  판정       : 실패\n    - ${failed.join('\n    - ')}`,
  );
  return lines.join('\n') + '\n';
}

export function summarize(data, test) {
  const testName = test || TEST;
  const setup = data.setup_data || {};
  const endedAt = new Date().toISOString();
  const meta = Object.assign(
    {
      test: testName,
      baseUrl: BASE_URL,
      startedAt: setup.startedAt || null,
      endedAt,
      shape: setup.shape || null,
      targetRps: TARGET_RPS,
      workload: { flows: FLOWS, avgRequests: AVG_REQUESTS, think: [THINK_MIN, THINK_MAX], nearRatio: NEAR_RATIO, nearDays: NEAR_DAYS, farDays: FAR_DAYS, maxNights: MAX_NIGHTS },
      users: setup.users ? setup.users.length : 0,
    },
    META,
  );
  const failed = failedThresholds(data);
  const result = { meta, passed: failed.length === 0, failedThresholds: failed, metrics: data.metrics };
  const file = `${RESULT_DIR}/${testName}-${endedAt.replace(/[:.]/g, '-')}.json`;
  return { stdout: text(data, meta, failed), [file]: JSON.stringify(result, null, 2) };
}
