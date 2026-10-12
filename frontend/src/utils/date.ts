// 예약 관련 페이지에서 쓰는 날짜 계산·포맷 유틸. Date 객체를 직접 다루는 순수 함수들만 모아둔다.

export const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'] as const

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

export function addDays(date: Date, amount: number): Date {
  const d = startOfDay(date)
  d.setDate(d.getDate() + amount)
  return d
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export function isBeforeDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() < startOfDay(b).getTime()
}

/** start와 end 사이(양 끝 제외)에 date가 있는지 — 달력에서 선택 구간 하이라이트용 */
export function isWithinRange(date: Date, start: Date, end: Date): boolean {
  const t = startOfDay(date).getTime()
  return t > startOfDay(start).getTime() && t < startOfDay(end).getTime()
}

export function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

export function formatDateWithWeekday(date: Date): string {
  return `${formatDate(date)}(${WEEKDAYS_KO[date.getDay()]})`
}

/** api-gateway가 쓰는 "YYYY-MM-DD" 형식 문자열을 Date로 변환한다. 형식이 올바르지 않으면 null */
export function formatMonthTitle(date: Date): string {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** hotel-service API가 쓰는 "YYYY-MM-DD" 형식으로 변환 */
export function formatDateISO(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** formatDateISO의 역변환. 형식이 올바르지 않으면 null */
export function parseDateISO(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const [, y, m, d] = match
  return new Date(Number(y), Number(m) - 1, Number(d))
}

/** a - b 사이의 일수 차이(박 수 계산 등에 사용). a가 b보다 미래면 양수 */
export function diffDays(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / MS_PER_DAY)
}

/**
 * 해당 월의 달력 셀 배열을 만든다. 1일 앞의 빈 칸(null)만 채우고, 말일 뒤의 빈 칸은
 * 채우지 않는다 — 참고 이미지의 달력도 다음 달 날짜를 표시하지 않고 그냥 비워둔다.
 */
export function getMonthCells(monthStart: Date): (Date | null)[] {
  const year = monthStart.getFullYear()
  const month = monthStart.getMonth()
  const firstWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const cells: (Date | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day))
  }
  return cells
}
