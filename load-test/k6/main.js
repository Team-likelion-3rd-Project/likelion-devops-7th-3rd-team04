// k6 부하 테스트 진입점 (LDP-196, 위키 「성능 테스트」)
//   k6 run -e TEST=smoke -e BASE_URL=... -e LT_PASSWORD=... load-test/k6/main.js
// 테스트 유형 · 부하 · 단계 값은 -e 로만 바꾼다 (load-test/README.md)
import { TEST, CONFIRM_LAG_SAMPLE } from './lib/config.js';
import { buildProfile } from './profiles/index.js';
import { collectCatalog, loginUsers, assertTokenLifetime } from './lib/setup.js';
import { summarize } from './lib/summary.js';

export { browse } from './flows/browse.js';
export { search } from './flows/search.js';
export { booking } from './flows/booking.js';
export { mypage } from './flows/mypage.js';
export { apiHotels, apiAvailability, apiBooking, apiLogin, apiConfirm } from './flows/api.js';

const profile = buildProfile(TEST);

export const options = {
  scenarios: profile.scenarios,
  thresholds: profile.thresholds,
  setupTimeout: '10m', // 테스트 사용자 로그인 (bcrypt)
  summaryTrendStats: ['count', 'avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  tags: { test: TEST },
};

export function setup() {
  const catalog = collectCatalog();
  const users = loginUsers(profile.loginUsers);
  assertTokenLifetime(users, profile.durationSeconds);
  return Object.assign(catalog, {
    users,
    confirmLagSample: profile.confirmLagSample !== undefined ? profile.confirmLagSample : CONFIRM_LAG_SAMPLE,
    shape: profile.shape,
    startedAt: new Date().toISOString(),
  });
}

export function handleSummary(data) {
  return summarize(data);
}
