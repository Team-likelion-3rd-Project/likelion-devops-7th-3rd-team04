import { toHttpException } from '@app/common';

// 예약 생성 멱등 키 (LDP-240) — 화면이 Idempotency-Key 헤더로 보낸다.
// 화면은 crypto.randomUUID()(36자)를 쓰지만, 다른 클라이언트도 쓸 수 있게 영문·숫자·-·_ 1~64자를 받는다
// (DB 컬럼 idempotency_key VARCHAR(64)). 헤더가 없으면 빈 값 → booking-service가 예전처럼 항상 새로 만든다.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseIdempotencyKey(
  raw: string | string[] | undefined,
): string {
  if (raw === undefined) return '';
  // 같은 헤더가 여러 번 오면 Node가 배열이나 "a, b"로 합친다 → 어느 키를 쓸지 모르니 거절
  const value = Array.isArray(raw) ? raw.join(',') : raw.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw toHttpException({
      status: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
      message: 'Idempotency-Key는 영문·숫자·-·_ 1~64자여야 합니다.',
      retryable: false,
    });
  }
  return value;
}
