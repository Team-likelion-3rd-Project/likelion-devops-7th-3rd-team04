// 결제 마감 시각 계산 — 예약을 만들 때 한 번 계산해 reservations.payment_due_at에 저장한다 (LDP-83 결정, LDP-92).
//  - 회원, 체크인이 오늘(한국 날짜)       → 생성 + 30분
//  - 회원, 체크인이 내일 이후              → 체크인 전날 밤 자정(= 체크인 날 00:00, 한국 시간)
//  - 직원이 만든 예약(대리 예약·연장 예약) → 만든 날 밤 자정(한국 시간)
//  - 어느 경우든 최소 30분은 보장 (예: 23:50에 만들면 00:20)
// 마감이 지나면 결제할 수 없고, 만료 배치(ReservationExpiryService)가 EXPIRED로 바꾸고 재고를 돌려놓는다.

export const PAYMENT_DUE_MINUTES = 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

// 한국 날짜 'YYYY-MM-DD'
export function kstDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

// 한국 날짜 'YYYY-MM-DD'의 00:00(한국 시간) 시각
function kstMidnightOf(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`) - KST_OFFSET_MS;
}

// 'YYYY-MM-DD' + 일 수
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computePaymentDueAt(params: {
  now: Date;
  checkInDate: string;
  createdByAdmin: boolean;
}): Date {
  const { now, checkInDate, createdByAdmin } = params;
  const today = kstDate(now);
  const minimum = now.getTime() + PAYMENT_DUE_MINUTES * MINUTE_MS;

  let due: number;
  if (createdByAdmin) {
    due = kstMidnightOf(addDays(today, 1));
  } else if (checkInDate <= today) {
    due = minimum;
  } else {
    due = kstMidnightOf(checkInDate);
  }
  return new Date(Math.max(due, minimum));
}
