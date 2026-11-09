import { HttpException } from '@nestjs/common';
import { parseIdempotencyKey } from './idempotency-key';

// LDP-240: 예약 생성 멱등 키 헤더 검사
describe('parseIdempotencyKey', () => {
  it('헤더가 없으면 빈 값 (멱등 키 없이 예약)', () => {
    expect(parseIdempotencyKey(undefined)).toBe('');
  });

  it('UUID는 그대로 통과', () => {
    const uuid = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
    expect(parseIdempotencyKey(uuid)).toBe(uuid);
  });

  it('앞뒤 공백은 지운다', () => {
    expect(parseIdempotencyKey('  abc_123  ')).toBe('abc_123');
  });

  it.each([
    ['빈 문자열', ''],
    ['65자', 'a'.repeat(65)],
    ['허용하지 않는 문자', 'abc def'],
    ['한글', '예약키'],
    ['헤더가 두 번 옴', ['a', 'b']],
  ])('%s이면 400 INVALID_IDEMPOTENCY_KEY', (_, raw) => {
    const thrown = (() => {
      try {
        parseIdempotencyKey(raw);
      } catch (e: unknown) {
        return e;
      }
    })() as HttpException;
    expect(thrown).toBeInstanceOf(HttpException);
    expect(thrown.getStatus()).toBe(400);
    expect(thrown.getResponse()).toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  });
});
