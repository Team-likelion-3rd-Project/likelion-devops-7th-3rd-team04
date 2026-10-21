import { computePaymentDueAt, kstDate } from './payment-due';

// LDP-92: 결제 마감 규칙 (LDP-83 결정) — 자정은 한국 시간, 최소 30분 보장
describe('computePaymentDueAt', () => {
  // KST = UTC + 9시간. 'KST 2026-11-01 10:00' = UTC 2026-11-01T01:00
  const kst = (date: string, time: string) =>
    new Date(Date.parse(`${date}T${time}:00.000Z`) - 9 * 60 * 60 * 1000);
  const due = (now: Date, checkInDate: string, createdByAdmin = false) =>
    computePaymentDueAt({ now, checkInDate, createdByAdmin }).toISOString();

  describe('회원 예약', () => {
    it('체크인이 오늘이면 생성 + 30분', () => {
      expect(due(kst('2026-11-01', '10:00'), '2026-11-01')).toBe(
        kst('2026-11-01', '10:30').toISOString(),
      );
    });

    it('체크인이 내일 이후면 체크인 전날 밤 자정 (= 체크인 날 00:00 KST)', () => {
      expect(due(kst('2026-11-01', '10:00'), '2026-11-05')).toBe(
        kst('2026-11-05', '00:00').toISOString(),
      );
    });

    it('내일 체크인을 23:50에 예약하면 자정까지 10분뿐이라 최소 30분 보장 (00:20)', () => {
      expect(due(kst('2026-11-01', '23:50'), '2026-11-02')).toBe(
        kst('2026-11-02', '00:20').toISOString(),
      );
    });

    it('한국 새벽(UTC로는 전날)에도 한국 날짜로 "오늘"을 판단한다', () => {
      // KST 11-02 01:00 = UTC 11-01 16:00 — 11-02 체크인은 "오늘 체크인"
      expect(due(kst('2026-11-02', '01:00'), '2026-11-02')).toBe(
        kst('2026-11-02', '01:30').toISOString(),
      );
    });
  });

  describe('직원이 만든 예약 (대리 예약·연장)', () => {
    it('만든 날 밤 자정 — 체크인 날짜와 관계없이', () => {
      expect(due(kst('2026-11-01', '10:00'), '2026-11-20', true)).toBe(
        kst('2026-11-02', '00:00').toISOString(),
      );
    });

    it('23:50에 만들면 최소 30분 보장 (00:20)', () => {
      expect(due(kst('2026-11-01', '23:50'), '2026-11-01', true)).toBe(
        kst('2026-11-02', '00:20').toISOString(),
      );
    });

    it('한국 새벽에 만들면 그날(KST) 밤 자정', () => {
      expect(due(kst('2026-11-02', '01:00'), '2026-11-05', true)).toBe(
        kst('2026-11-03', '00:00').toISOString(),
      );
    });
  });

  it('kstDate: UTC 15:00 이후는 한국 날짜로 다음 날', () => {
    expect(kstDate(new Date('2026-11-01T14:59:00Z'))).toBe('2026-11-01');
    expect(kstDate(new Date('2026-11-01T15:00:00Z'))).toBe('2026-11-02');
  });
});
