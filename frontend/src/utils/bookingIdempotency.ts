// 예약 생성 멱등 키 (LDP-240).
// 예약 요청이 503으로 끝나도 서버는 예약을 만들었을 수 있다. 사용자가 다시 누를 때 같은 키를 보내면
// 서버가 새로 만들지 않고 처음 만든 예약을 돌려준다 (Idempotency-Key 헤더).
//
// - 키는 "예약 조건"(객실·날짜·인원·옵션)마다 하나. 조건이 바뀌면 다른 예약이므로 새 키를 만든다.
// - 새로고침해도 같은 키를 쓰도록 이 탭의 sessionStorage에 둔다 (탭을 닫으면 사라짐).
// - 예약이 성공하면 지운다 — 같은 조건으로 일부러 한 번 더 예약할 때는 새 키가 나가야 한다.

export interface BookingConditions {
  roomId: number
  checkInDate: string
  checkOutDate: string
  guestCount: number
  poolGuestCount: number
  loungeGuestCount: number
}

const STORAGE_PREFIX = 'booking-idempotency:'

function storageKey(conditions: BookingConditions): string {
  const { roomId, checkInDate, checkOutDate, guestCount, poolGuestCount, loungeGuestCount } = conditions
  return `${STORAGE_PREFIX}${roomId}|${checkInDate}|${checkOutDate}|${guestCount}|${poolGuestCount}|${loungeGuestCount}`
}

function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // randomUUID가 없는 환경(오래된 브라우저, https가 아닌 주소) 대비: 같은 길이·문자 범위의 무작위 값
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 이 조건의 키. 이전에 실패한 시도가 있으면 그 키를 그대로 돌려준다. */
export function bookingIdempotencyKey(conditions: BookingConditions): string {
  const key = storageKey(conditions)
  try {
    const saved = sessionStorage.getItem(key)
    if (saved) return saved
    const created = newKey()
    sessionStorage.setItem(key, created)
    return created
  } catch {
    // 저장소를 못 쓰면(사생활 보호 모드 등) 이 시도에만 쓰는 키 — 같은 화면에서 다시 누르는 경우는 메모리 키로 막는다
    return memoryKeys.get(key) ?? memoryKeys.set(key, newKey()).get(key)!
  }
}

/** 예약이 성공하면 지운다. */
export function clearBookingIdempotencyKey(conditions: BookingConditions): void {
  const key = storageKey(conditions)
  memoryKeys.delete(key)
  try {
    sessionStorage.removeItem(key)
  } catch {
    // 저장소를 못 쓰면 지울 것도 없다
  }
}

const memoryKeys = new Map<string, string>()
