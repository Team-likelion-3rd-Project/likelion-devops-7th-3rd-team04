import { status as GrpcStatus } from '@grpc/grpc-js';
import {
  apiRpcException,
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
