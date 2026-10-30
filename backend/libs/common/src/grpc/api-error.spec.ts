import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  apiRpcException,
  grpcErrorToHttp,
  grpcStatusForHttp,
  grpcStatusOf,
  parseApiRpcError,
  rpcError,
} from './api-error';

// LDP-167: gRPC 오류에 상태 코드를 붙여 비즈니스 거절과 서버 오류를 구분한다
describe('rpcError', () => {
  it('상태 코드와 메시지를 담는다 (메시지는 gRPC details로 그대로 전달)', () => {
    const exception = rpcError(
      GrpcStatus.NOT_FOUND,
      '존재하지 않는 호텔입니다.',
    );

    expect(exception.getError()).toEqual({
      code: GrpcStatus.NOT_FOUND,
      message: '존재하지 않는 호텔입니다.',
    });
    expect(exception.message).toBe('존재하지 않는 호텔입니다.');
  });
});

describe('grpcStatusForHttp', () => {
  it('api-gateway가 돌려줄 HTTP 상태를 gRPC 상태 코드로 바꾼다', () => {
    expect(grpcStatusForHttp(400)).toBe(GrpcStatus.INVALID_ARGUMENT);
    expect(grpcStatusForHttp(401)).toBe(GrpcStatus.UNAUTHENTICATED);
    expect(grpcStatusForHttp(403)).toBe(GrpcStatus.PERMISSION_DENIED);
    expect(grpcStatusForHttp(404)).toBe(GrpcStatus.NOT_FOUND);
    expect(grpcStatusForHttp(409)).toBe(GrpcStatus.FAILED_PRECONDITION);
    expect(grpcStatusForHttp(503)).toBe(GrpcStatus.UNAVAILABLE);
  });

  it('정하지 않은 상태는 UNKNOWN', () => {
    expect(grpcStatusForHttp(500)).toBe(GrpcStatus.UNKNOWN);
  });
});

describe('grpcStatusOf', () => {
  it('받은 gRPC 오류의 상태 코드를 이어받는다', () => {
    expect(grpcStatusOf({ code: GrpcStatus.ALREADY_EXISTS })).toBe(
      GrpcStatus.ALREADY_EXISTS,
    );
    expect(grpcStatusOf({ code: GrpcStatus.UNAVAILABLE })).toBe(
      GrpcStatus.UNAVAILABLE,
    );
  });

  it('코드가 없거나 gRPC 코드가 아니면 UNKNOWN', () => {
    expect(grpcStatusOf(new Error('x'))).toBe(GrpcStatus.UNKNOWN);
    expect(grpcStatusOf({ code: 'ER_DUP_ENTRY' })).toBe(GrpcStatus.UNKNOWN);
    expect(grpcStatusOf({ code: 99 })).toBe(GrpcStatus.UNKNOWN);
    expect(grpcStatusOf(undefined)).toBe(GrpcStatus.UNKNOWN);
  });
});

describe('apiRpcException', () => {
  const payload = {
    status: 409,
    code: 'ROOM_NOT_AVAILABLE',
    message: '예약 가능한 객실이 아닙니다.',
    retryable: false,
  };

  it('HTTP 상태에 맞는 gRPC 상태 코드로 던진다', () => {
    const error = apiRpcException(payload).getError() as { code: number };

    expect(error.code).toBe(GrpcStatus.FAILED_PRECONDITION);
  });

  it('api-gateway는 이전과 같이 payload를 꺼낸다', () => {
    // 같은 프로세스에서 받은 경우 (message)
    expect(parseApiRpcError(apiRpcException(payload))).toEqual(payload);

    // gRPC를 거쳐 받은 경우: details에 메시지, message에 "9 FAILED_PRECONDITION: …" 접두어
    const details = apiRpcException(payload).message;
    expect(
      parseApiRpcError({
        code: GrpcStatus.FAILED_PRECONDITION,
        details,
        message: `9 FAILED_PRECONDITION: ${details}`,
      }),
    ).toEqual(payload);
  });
});

// LDP-198: gateway가 실패 이유를 보고 HTTP 상태를 고른다 — 서비스 장애가 404·401로 보이지 않게
describe('grpcErrorToHttp', () => {
  const unavailable = {
    code: 'HOTEL_SERVICE_UNAVAILABLE',
    message: '잠시 후 다시 시도해 주세요.',
  };
  const responseOf = (err: unknown, codes = {}) => {
    const exception = grpcErrorToHttp(err, unavailable, codes);
    return { status: exception.getStatus(), body: exception.getResponse() };
  };

  it.each([
    [GrpcStatus.INVALID_ARGUMENT, 400, 'INVALID_REQUEST'],
    [GrpcStatus.UNAUTHENTICATED, 401, 'UNAUTHENTICATED'],
    [GrpcStatus.PERMISSION_DENIED, 403, 'FORBIDDEN'],
    [GrpcStatus.NOT_FOUND, 404, 'NOT_FOUND'],
    [GrpcStatus.FAILED_PRECONDITION, 409, 'CONFLICT'],
  ])(
    '요청 쪽 거절(gRPC %s)은 %s, 메시지는 서비스가 보낸 그대로',
    (code, status, errorCode) => {
      expect(responseOf({ code, details: '거절 이유' })).toMatchObject({
        status,
        body: {
          statusCode: status,
          code: errorCode,
          message: '거절 이유',
          retryable: false,
        },
      });
    },
  );

  it('codes로 4xx의 code를 바꾼다', () => {
    expect(
      responseOf(
        { code: GrpcStatus.NOT_FOUND, details: '존재하지 않는 호텔입니다.' },
        { 404: 'HOTEL_NOT_FOUND' },
      ).body,
    ).toMatchObject({ code: 'HOTEL_NOT_FOUND' });
  });

  it.each([
    ['연결 실패', GrpcStatus.UNAVAILABLE],
    ['시간 초과', GrpcStatus.DEADLINE_EXCEEDED],
    ['알 수 없는 오류', GrpcStatus.UNKNOWN],
    ['내부 오류', GrpcStatus.INTERNAL],
  ])('%s는 503 + 다시 시도 가능 (서비스 메시지는 숨김)', (_, code) => {
    expect(responseOf({ code, details: 'connect ECONNREFUSED' })).toMatchObject(
      {
        status: 503,
        body: {
          statusCode: 503,
          error: 'Service Unavailable',
          ...unavailable,
          retryable: true,
        },
      },
    );
  });

  it('상태 코드가 없는 오류도 503', () => {
    expect(responseOf(new Error('boom')).status).toBe(503);
  });

  it('api-error 형식이면 서비스가 정한 상태·code를 그대로 쓴다', () => {
    const payload = {
      status: 409,
      code: 'ROOM_NOT_AVAILABLE',
      message: '매진입니다.',
      retryable: false,
    };
    const err = apiRpcException(payload).getError() as { message: string };

    expect(
      responseOf({
        code: GrpcStatus.FAILED_PRECONDITION,
        details: err.message,
      }),
    ).toMatchObject({
      status: 409,
      body: {
        statusCode: 409,
        code: 'ROOM_NOT_AVAILABLE',
        message: '매진입니다.',
        retryable: false,
      },
    });
  });
});
