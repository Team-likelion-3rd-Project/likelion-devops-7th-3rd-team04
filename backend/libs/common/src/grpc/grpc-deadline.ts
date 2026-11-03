// libs/common/src/grpc/grpc-deadline.ts
import { InterceptingCall, type Interceptor } from '@grpc/grpc-js';

// gRPC 호출 기한(deadline) 인터셉터 (LDP-223).
// 기한이 없는 호출은 상대 Pod가 응답 없이 사라지면(롤링 재시작·장애) 끝나지 않고 매달린다.
// 기한을 넘기면 grpc-js가 호출을 끊고 DEADLINE_EXCEEDED로 실패시킨다.
//  - 호출하는 쪽이 이미 기한을 넘겼으면(CallOptions.deadline) 그 값을 그대로 쓴다.
//  - 메서드별 기한은 gRPC 경로('/<package>.<Service>/<Method>')로 찾고, 없으면 기본값을 쓴다.
export function grpcDeadlineInterceptor(
  defaultMs: number,
  msByPath: Record<string, number> = {},
): Interceptor {
  return (options, nextCall) => {
    if (options.deadline === undefined) {
      const ms = msByPath[options.method_definition.path] ?? defaultMs;
      options = { ...options, deadline: Date.now() + ms };
    }
    return new InterceptingCall(nextCall(options));
  };
}
