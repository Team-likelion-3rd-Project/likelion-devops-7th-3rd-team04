// 전역 요청 제한 기본 한도(IP당 1분 동안 허용하는 요청 수).
export const DEFAULT_THROTTLE_LIMIT = 100;

// THROTTLE_LIMIT 환경변수로 한도를 바꾼다 (LDP-186). k6 부하 테스트는 한 IP에서 보내므로 테스트 날에만
// 크게 올린다 — 1분 기준이라 초당 500건이면 30,000 이상이 필요하다. 없거나 1 이상의 정수가 아니면 100.
// @Throttle()로 따로 정한 라우트(토큰 재발급·챗봇)의 한도는 바뀌지 않는다.
export function throttleLimitFromEnv(): number {
  const limit = Number(process.env.THROTTLE_LIMIT);
  return Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_THROTTLE_LIMIT;
}
