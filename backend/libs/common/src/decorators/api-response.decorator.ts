import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

// 🟢 400, 401, 500, 503 에러 응답을 하나로 묶어주는 함수
export function ApiCommonResponses() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: '잘못된 입력값 (유효성 검사 실패)',
    }),
    ApiResponse({
      status: 401,
      description: '인증 실패 (JWT 토큰 누락 또는 만료)',
    }),
    ApiResponse({
      status: 500,
      description: '서버 내부 오류',
    }),
    ApiResponse({
      status: 503,
      description:
        '서비스 일시 장애 — 내부 서비스 연결 실패·시간 초과 (code: *_SERVICE_UNAVAILABLE, retryable: true)',
    }),
  );
}
