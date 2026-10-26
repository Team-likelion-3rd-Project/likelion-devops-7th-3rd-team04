// 로그에 개인정보가 섞이지 않게 값을 가린다 (LDP-163).

// 오류 문장 안의 작은따옴표 값 → '?'.
// DB 오류는 실제 값을 문장에 담는다 (예: Duplicate entry 'kim@example.com' for key 'users.IDX_email').
// 어느 칸·키에서 났는지는 추적에 필요하므로 `key '…'`·`column '…'`·`table '…'` 뒤의 이름은 남긴다.
export function redactSqlValues(text: string): string {
  return text.replace(
    /(?<!\b(?:key|column|table|database|constraint) )'(?:[^'\\]|\\.)*'/gi,
    "'?'",
  );
}

// logger.error(메시지, 여기)에 넘길 오류 내용 — stack(없으면 문자열)에서 값을 가린다
export function errorTrace(error: unknown): string {
  const text =
    error instanceof Error
      ? (error.stack ?? error.message)
      : typeof error === 'object' && error !== null
        ? ((error as { stack?: string }).stack ??
          (error as { details?: string }).details ??
          safeJson(error))
        : String(error);
  return redactSqlValues(text);
}

// gRPC 오류처럼 Error가 아닌 객체는 내용이 보이게 JSON으로 (순환 참조 등으로 실패하면 표시만)
function safeJson(value: object): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[오류 객체]';
  }
}
