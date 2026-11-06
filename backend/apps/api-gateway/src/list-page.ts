// 회원 목록 API(내 예약 · 내 결제 · 관리자 회원 예약 · 결제)의 페이지 값 (부하 테스트 3일차 11-06).
// 예전에는 page 없이 부르면 회원 데이터 전체를 돌려줘서, 예약 · 결제가 쌓일수록 응답과 처리 시간이 끝없이 커졌다.
// 이제 page를 주지 않아도 최신순 앞쪽 UNPAGED_LIMIT건까지만 돌려준다 — 잘렸는지는 응답의 total로 안다.

// page를 줄 때 한 페이지 기본 크기
export const DEFAULT_PAGE_SIZE = 20;
// page 없이 부를 때 돌려주는 최대 건수 (size 상한과 같다)
export const UNPAGED_LIMIT = 100;

// gRPC에 넘길 page · size. 항상 1 이상의 page를 넘겨 서비스가 전체를 읽지 않게 한다.
export function listPage(query: { page?: number; size?: number }): {
  page: number;
  size: number;
} {
  if (query.page) {
    return { page: query.page, size: query.size ?? DEFAULT_PAGE_SIZE };
  }
  return { page: 1, size: query.size ?? UNPAGED_LIMIT };
}
