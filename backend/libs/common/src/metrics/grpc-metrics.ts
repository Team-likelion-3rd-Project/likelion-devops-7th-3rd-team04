import {
  InterceptingCall,
  Interceptor,
  ServerInterceptingCall,
  ServerInterceptor,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import { Histogram, Registry } from 'prom-client';
import { activeMetricsRegistry, LATENCY_BUCKETS } from './metrics';

// gRPC 호출 측정 (LDP-169). grpc-js 인터셉터로 서버·클라이언트를 한 곳에서 잰다 — 컨트롤러는 손대지 않는다.
//  - rpc_server_duration_seconds: 이 서비스가 받은 호출   {rpc_service, rpc_method, grpc_code}
//  - rpc_client_duration_seconds: 이 서비스가 보낸 호출   {peer_service, rpc_service, rpc_method, grpc_code}
// grpc_code는 OK/비OK 비율과 지연 확인용 (알림 기준은 api-gateway의 HTTP 5xx). 실패 종류는 LDP-167에서 코드로 구분된다.
// grpc-options.ts가 METRICS_PORT가 있을 때만 이 인터셉터를 넣는다 → 꺼져 있으면 호출 경로에 아무것도 끼지 않는다.

// proto 패키지 → 그 패키지를 서비스하는 앱 (backend/apps 폴더 이름). hotel.NoticeService·user.AdminService처럼
// 한 패키지에 서비스가 여러 개여도 같은 앱이다
const SERVICE_BY_PACKAGE: Record<string, string> = {
  auth: 'auth-service',
  booking: 'booking-service',
  chatBot: 'chat-bot-service',
  hotel: 'hotel-service',
  payment: 'payment-service',
  user: 'user-service',
};

// '/booking.BookingService/CreateBooking' → booking.BookingService, CreateBooking
export function splitGrpcPath(path: string): {
  rpcService: string;
  rpcMethod: string;
} {
  const [rpcService = 'unknown', rpcMethod = 'unknown'] = path
    .replace(/^\//, '')
    .split('/');
  return { rpcService, rpcMethod };
}

// booking.BookingService → booking-service
export function peerServiceOf(rpcService: string): string {
  return SERVICE_BY_PACKAGE[rpcService.split('.')[0]] ?? 'unknown';
}

// 숫자 코드 → 대문자 이름 (5 → NOT_FOUND). 숫자와 이름을 섞어 쓰지 않는다
export function grpcCodeName(code: number): string {
  return GrpcStatus[code] ?? 'UNKNOWN';
}

// 레지스트리마다 히스토그램을 한 번만 만든다
const histograms = new WeakMap<
  Registry,
  { server: Histogram<string>; client: Histogram<string> }
>();

function histogramsFor(registry: Registry) {
  let found = histograms.get(registry);
  if (!found) {
    found = {
      server: new Histogram({
        name: 'rpc_server_duration_seconds',
        help: '받은 gRPC 호출 처리 시간(초)',
        labelNames: ['rpc_service', 'rpc_method', 'grpc_code'],
        buckets: LATENCY_BUCKETS,
        registers: [registry],
      }),
      client: new Histogram({
        name: 'rpc_client_duration_seconds',
        help: '보낸 gRPC 호출이 응답받기까지 걸린 시간(초)',
        labelNames: ['peer_service', 'rpc_service', 'rpc_method', 'grpc_code'],
        buckets: LATENCY_BUCKETS,
        registers: [registry],
      }),
    };
    histograms.set(registry, found);
  }
  return found;
}

// 서버: 호출을 받은 순간부터 상태(OK·NOT_FOUND …)를 돌려보내는 순간까지
export const grpcServerMetricsInterceptor: ServerInterceptor = (
  methodDescriptor,
  call,
) => {
  const registry = activeMetricsRegistry();
  if (!registry) {
    return new ServerInterceptingCall(call);
  }
  const { rpcService, rpcMethod } = splitGrpcPath(methodDescriptor.path);
  const end = histogramsFor(registry).server.startTimer({
    rpc_service: rpcService,
    rpc_method: rpcMethod,
  });
  return new ServerInterceptingCall(call, {
    sendStatus: (status, next) => {
      end({ grpc_code: grpcCodeName(status.code) });
      next(status);
    },
  });
};

// 클라이언트: 호출을 보낸 순간부터 상대의 상태를 받은 순간까지 (연결 실패면 UNAVAILABLE, 시간 초과면 DEADLINE_EXCEEDED)
export const grpcClientMetricsInterceptor: Interceptor = (
  options,
  nextCall,
) => {
  const registry = activeMetricsRegistry();
  if (!registry) {
    return new InterceptingCall(nextCall(options));
  }
  const { rpcService, rpcMethod } = splitGrpcPath(
    options.method_definition.path,
  );
  const histogram = histogramsFor(registry).client;
  return new InterceptingCall(nextCall(options), {
    start: (metadata, listener, next) => {
      const end = histogram.startTimer({
        peer_service: peerServiceOf(rpcService),
        rpc_service: rpcService,
        rpc_method: rpcMethod,
      });
      next(metadata, {
        onReceiveStatus: (status, nextStatus) => {
          end({ grpc_code: grpcCodeName(status.code) });
          nextStatus(status);
        },
      });
    },
  });
};
