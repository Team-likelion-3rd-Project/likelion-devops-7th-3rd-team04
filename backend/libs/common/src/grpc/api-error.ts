import { status as GrpcStatus } from '@grpc/grpc-js';
import { HttpException } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

// gRPC 오류에 상태 코드를 붙인다 (LDP-167).
// 코드 없이 던지면 비즈니스 거절(객실 마감 등)과 서버 오류가 전부 UNKNOWN으로 나가서 구분할 수 없다.
// 메시지는 그대로 details로 전달되므로, api-gateway의 메시지 기반 분기·응답 문구는 바뀌지 않는다.
// 예상하지 못한 예외(RpcException이 아닌 것)는 Nest가 그대로 UNKNOWN으로 보내 서버 오류로 구분된다.
export function rpcError(code: GrpcStatus, message: string): RpcException {
  return new RpcException({ code, message });
}

// api-gateway가 돌려줄 HTTP 상태 → gRPC 상태 코드
const GRPC_STATUS_BY_HTTP: Record<number, GrpcStatus> = {
  400: GrpcStatus.INVALID_ARGUMENT,
  401: GrpcStatus.UNAUTHENTICATED,
  403: GrpcStatus.PERMISSION_DENIED,
  404: GrpcStatus.NOT_FOUND,
  409: GrpcStatus.FAILED_PRECONDITION,
  429: GrpcStatus.RESOURCE_EXHAUSTED,
  503: GrpcStatus.UNAVAILABLE,
};

export function grpcStatusForHttp(status: number): GrpcStatus {
  return GRPC_STATUS_BY_HTTP[status] ?? GrpcStatus.UNKNOWN;
}

// 다른 서비스에서 받은 gRPC 오류의 상태 코드 (메시지만 바꿔 다시 던질 때 코드를 이어받는다)
export function grpcStatusOf(err: unknown): GrpcStatus {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'number' && code in GrpcStatus
    ? code
    : GrpcStatus.UNKNOWN;
}

// 결제 API(위키 API 명세 5.10)처럼 프론트가 `code`/`retryable`로 분기해야 하는 실패를
// 서비스 간(gRPC) 경계를 넘어 그대로 전달하기 위한 형식입니다.
//
// gRPC 에러는 문자열(details) 하나만 실어 나를 수 있어서, 이 형식을 JSON 문자열로 담아
// RpcException으로 던지고(내부 서비스), api-gateway가 꺼내서 HTTP 응답으로 바꿉니다.
export interface ApiErrorPayload {
  status: number; // api-gateway가 돌려줄 HTTP 상태 코드
  code: string; // 오류 종류 (예: PAYMENT_DUE_EXPIRED)
  message: string; // 사용자에게 보여줄 문구
  retryable: boolean; // 같은 예약으로 다시 결제할 수 있는지
}

const MARKER = '__apiError';

// 내부 서비스(booking-service 등)에서 던집니다.
export function apiRpcException(payload: ApiErrorPayload): RpcException {
  return rpcError(
    grpcStatusForHttp(payload.status),
    JSON.stringify({ [MARKER]: payload }),
  );
}

// api-gateway에서 gRPC 에러를 받아 apiRpcException 형식이면 꺼내고, 아니면 null을 돌려줍니다.
export function parseApiRpcError(err: unknown): ApiErrorPayload | null {
  const raw =
    (err as { details?: unknown })?.details ??
    (err as { message?: unknown })?.message;
  if (typeof raw !== 'string' || !raw.includes(MARKER)) {
    return null;
  }
  try {
    // gRPC가 details 앞에 "2 UNKNOWN: " 같은 접두어를 붙이는 경우가 있어 첫 '{'부터 파싱합니다.
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'))) as Record<
      string,
      ApiErrorPayload
    >;
    return parsed[MARKER] ?? null;
  } catch {
    return null;
  }
}

// api-gateway에서 HTTP 응답으로 바꿉니다. 응답 형식은 위키 API 명세 5.10:
// { statusCode, error, code, message, retryable }
export function toHttpException(payload: ApiErrorPayload): HttpException {
  const errorName: Record<number, string> = {
    400: 'Bad Request',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    503: 'Service Unavailable',
  };
  return new HttpException(
    {
      statusCode: payload.status,
      error: errorName[payload.status] ?? 'Error',
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable,
    },
    payload.status,
  );
}
