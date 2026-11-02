import { ApiError } from '../api/gateway'

// 카카오 로그인 실패 code → 화면 문구 (백엔드 API 명세 2.11, LDP-194)
const KAKAO_ERROR_MESSAGES: Record<string, string> = {
  SOCIAL_STATE_INVALID: '로그인 요청이 만료되었어요. 카카오 로그인을 다시 시도해 주세요.',
  SOCIAL_LOGIN_FAILED: '카카오 로그인에 실패했어요. 다시 시도해 주세요.',
  SOCIAL_EMAIL_REQUIRED: '카카오 계정의 이메일 제공에 동의해야 가입할 수 있어요. 동의 항목을 확인한 뒤 다시 시도해 주세요.',
  SOCIAL_EMAIL_IN_USE: '이미 이메일로 가입된 계정이에요. 이메일과 비밀번호로 로그인해 주세요.',
  SOCIAL_ACCOUNT_EXISTS: '이미 카카오로 가입된 이메일이에요. 카카오 로그인을 이용해 주세요.',
  SOCIAL_SIGNUP_EXPIRED: '가입 시간(10분)이 지났어요. 카카오 로그인부터 다시 진행해 주세요.',
  SOCIAL_LOGIN_DISABLED: '지금은 카카오 로그인을 사용할 수 없어요. 이메일로 로그인해 주세요.',
  SOCIAL_ACCOUNT_NOT_FOUND: '회원 정보를 찾을 수 없어요. 고객센터로 문의해 주세요.',
}

export function kakaoErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code && KAKAO_ERROR_MESSAGES[err.code]) {
    return KAKAO_ERROR_MESSAGES[err.code]
  }
  return '일시적인 오류로 카카오 로그인을 하지 못했어요. 잠시 후 다시 시도해 주세요.'
}
