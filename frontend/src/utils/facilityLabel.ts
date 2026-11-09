// 예약에 저장된 시설 이름 → 화면 표시. 성인 요금 시설은 이름이 수영장 · 라운지 그대로다 (LDP-247)
const ADULT_FACILITY_LABEL: Record<string, string> = {
  수영장: '수영장 성인',
  라운지: '라운지 성인',
}

export function facilityLabel(facilityName: string): string {
  return ADULT_FACILITY_LABEL[facilityName] ?? facilityName
}

export function hasFacility(facilities: { facilityName: string }[], name: '수영장' | '라운지'): boolean {
  return facilities.some((f) => f.facilityName.startsWith(name))
}
