import { sanitizeChatAction } from './chat-action';

describe('sanitizeChatAction', () => {
  // 2026-10-19 10:00 KST
  const now = new Date('2026-10-19T01:00:00.000Z');
  const empty = {
    hotel: '',
    roomName: '',
    checkIn: '',
    checkOut: '',
    adults: 0,
    children: 0,
  };
  const book = (overrides: Record<string, unknown> = {}) => ({
    type: 'BOOK',
    hotel: 'seoul',
    roomName: '디럭스 더블룸',
    checkIn: '2026-10-23',
    checkOut: '2026-10-25',
    adults: 2,
    children: 1,
    ...overrides,
  });

  describe('로그인 사용자', () => {
    it('passes a valid BOOK action', () => {
      expect(sanitizeChatAction(book(), 'BOOK', 1, now)).toEqual({
        type: 'BOOK',
        hotel: 'seoul',
        roomName: '디럭스 더블룸',
        checkIn: '2026-10-23',
        checkOut: '2026-10-25',
        adults: 2,
        children: 1,
      });
    });

    it.each(['PAY', 'CANCEL'])(
      'keeps only the type for %s (drops reservationId, url, ...)',
      (type) => {
        expect(
          sanitizeChatAction(
            { type, reservationId: 5, url: 'https://evil.example' },
            type,
            1,
            now,
          ),
        ).toEqual({ type, ...empty });
      },
    );

    it('drops unknown fields from BOOK', () => {
      const result = sanitizeChatAction(
        book({ url: 'https://evil.example', reservationId: 5 }),
        'BOOK',
        1,
        now,
      );
      expect(result).not.toHaveProperty('url');
      expect(result).not.toHaveProperty('reservationId');
    });

    it.each([
      ['unknown type', { type: 'REFUND_ALL' }],
      ['LOGIN_REQUIRED from the LLM', { type: 'LOGIN_REQUIRED' }],
      ['non-object', 'BOOK'],
      ['array', [book()]],
      ['null', null],
      ['undefined', undefined],
    ])('returns null for %s', (_label, raw) => {
      expect(sanitizeChatAction(raw, 'BOOK', 1, now)).toBeNull();
    });

    it.each([
      ['unknown hotel', { hotel: 'https://evil.example' }],
      ['missing hotel', { hotel: undefined }],
      ['past check-in', { checkIn: '2026-10-18', checkOut: '2026-10-20' }],
      ['reversed dates', { checkIn: '2026-10-25', checkOut: '2026-10-23' }],
      ['zero nights', { checkIn: '2026-10-23', checkOut: '2026-10-23' }],
      ['beyond 365 days', { checkIn: '2026-10-23', checkOut: '2027-10-21' }],
      ['non-existent date', { checkIn: '2026-02-30', checkOut: '2026-03-02' }],
      ['wrong format', { checkIn: '20261023' }],
      ['missing dates', { checkIn: undefined, checkOut: undefined }],
    ])('drops BOOK with %s', (_label, overrides) => {
      expect(sanitizeChatAction(book(overrides), 'BOOK', 1, now)).toBeNull();
    });

    it('accepts check-in today (KST) even when UTC is still yesterday', () => {
      // 2026-10-19 00:30 KST = 2026-10-18 15:30 UTC
      const earlyMorning = new Date('2026-10-18T15:30:00.000Z');
      expect(
        sanitizeChatAction(
          book({ checkIn: '2026-10-19', checkOut: '2026-10-20' }),
          'BOOK',
          1,
          earlyMorning,
        ),
      ).not.toBeNull();
    });

    it.each([
      [undefined, 2],
      [0, 2],
      [11, 2],
      [2.5, 2],
      ['3', 2],
      [3, 3],
    ])('normalizes adults %p to %p', (adults, expected) => {
      expect(sanitizeChatAction(book({ adults }), 'BOOK', 1, now)?.adults).toBe(
        expected,
      );
    });

    it.each([
      [undefined, 0],
      [-1, 0],
      [11, 0],
      [2, 2],
    ])('normalizes children %p to %p', (children, expected) => {
      expect(
        sanitizeChatAction(book({ children }), 'BOOK', 1, now)?.children,
      ).toBe(expected);
    });

    it('blanks an over-long or non-string room name but keeps the action', () => {
      expect(
        sanitizeChatAction(book({ roomName: 'x'.repeat(51) }), 'BOOK', 1, now)
          ?.roomName,
      ).toBe('');
      expect(
        sanitizeChatAction(book({ roomName: 42 }), 'BOOK', 1, now)?.roomName,
      ).toBe('');
    });
  });

  describe('비로그인 사용자 (userId 0)', () => {
    it.each(['BOOK', 'PAY', 'CANCEL'])(
      'turns intent %s into LOGIN_REQUIRED and ignores the action',
      (intent) => {
        expect(sanitizeChatAction(book(), intent, 0, now)).toEqual({
          type: 'LOGIN_REQUIRED',
          ...empty,
        });
      },
    );

    it.each([null, undefined, 'REFUND_ALL', 'LOGIN_REQUIRED'])(
      'returns null when intent is %p',
      (intent) => {
        expect(sanitizeChatAction(book(), intent, 0, now)).toBeNull();
      },
    );
  });
});
