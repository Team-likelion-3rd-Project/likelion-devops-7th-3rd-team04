// 서버 장애·네트워크 오류 때 고객에게 보여줄 문구 (LDP-235).
// `502 Bad Gateway`나 내부 주소가 담긴 서버 메시지가 화면에 그대로 나오지 않게 한다.
export const TEMPORARY_ERROR_MESSAGE = '일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.'
const LOGIN_EXPIRED_MESSAGE = '로그인이 만료되었습니다. 다시 로그인해주세요.'
const RATE_LIMITED_MESSAGE = '요청이 많아 잠시 제한되었습니다. 잠시 후 다시 시도해주세요.'
const REQUEST_FAILED_MESSAGE = '요청을 처리하지 못했습니다. 입력 내용을 확인해주세요.'

// 화면에 보여줘도 되는 서버 메시지만 돌려준다. 5xx는 서버가 오류 코드와 함께 준 안내만 믿는다.
export function displayableServerMessage(status: number, code?: string, message?: string): string | undefined {
  if (!message || status === 429) return undefined
  if (status === 401 && message === 'Unauthorized') return undefined
  if (status >= 500 && !code) return undefined
  return message
}

export function httpFallbackMessage(status: number): string {
  if (status === 401) return LOGIN_EXPIRED_MESSAGE
  if (status === 429) return RATE_LIMITED_MESSAGE
  if (status >= 500) return TEMPORARY_ERROR_MESSAGE
  return REQUEST_FAILED_MESSAGE
}

export function apiErrorMessage(status: number, code?: string, message?: string): string {
  return displayableServerMessage(status, code, message) ?? httpFallbackMessage(status)
}

// 네트워크가 끊겨 fetch가 던지는 `Failed to fetch`를 안내 문구로 바꾼다.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch {
    throw new Error(TEMPORARY_ERROR_MESSAGE)
  }
}
