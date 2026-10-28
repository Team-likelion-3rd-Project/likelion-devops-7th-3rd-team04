import {
  Client,
  credentials,
  Metadata,
  Server,
  ServerCredentials,
  ServiceDefinition,
  status as GrpcStatus,
} from '@grpc/grpc-js';
import { getGrpcOptions, getGrpcServerOptions } from '../grpc/grpc-options';
import {
  grpcClientMetricsInterceptor,
  grpcCodeName,
  grpcServerMetricsInterceptor,
  peerServiceOf,
  splitGrpcPath,
} from './grpc-metrics';
import { AppMetrics, startMetrics } from './metrics';

// LDP-169: gRPC 서버·클라이언트 호출 측정
describe('라벨 값 변환', () => {
  it('경로를 서비스와 메서드로 나눈다', () => {
    expect(splitGrpcPath('/booking.BookingService/CreateBooking')).toEqual({
      rpcService: 'booking.BookingService',
      rpcMethod: 'CreateBooking',
    });
  });

  it('proto 패키지로 호출 대상 앱을 찾는다 (한 패키지의 여러 서비스도 같은 앱)', () => {
    expect(peerServiceOf('booking.BookingService')).toBe('booking-service');
    expect(peerServiceOf('hotel.NoticeService')).toBe('hotel-service');
    expect(peerServiceOf('user.AdminService')).toBe('user-service');
    expect(peerServiceOf('chatBot.ChatBotService')).toBe('chat-bot-service');
    expect(peerServiceOf('other.Service')).toBe('unknown');
  });

  it('상태 코드는 대문자 이름으로', () => {
    expect(grpcCodeName(GrpcStatus.OK)).toBe('OK');
    expect(grpcCodeName(GrpcStatus.NOT_FOUND)).toBe('NOT_FOUND');
    expect(grpcCodeName(99)).toBe('UNKNOWN');
  });
});

describe('gRPC 옵션의 측정 인터셉터', () => {
  const before = process.env.METRICS_PORT;
  afterEach(() => {
    process.env.METRICS_PORT = before;
  });

  const interceptorsOf = (options: { options?: unknown }) =>
    (options.options as { channelOptions: Record<string, unknown> })
      .channelOptions.interceptors;

  it('METRICS_PORT가 없으면 넣지 않는다', () => {
    delete process.env.METRICS_PORT;
    expect(interceptorsOf(getGrpcOptions('booking', 'b.proto', 'x'))).toBe(
      undefined,
    );
    expect(
      interceptorsOf(getGrpcServerOptions('booking', 'b.proto', 'x')),
    ).toBe(undefined);
  });

  it('있으면 클라이언트·서버에 각자의 인터셉터를 넣는다', () => {
    process.env.METRICS_PORT = '9464';
    expect(interceptorsOf(getGrpcOptions('booking', 'b.proto', 'x'))).toEqual([
      grpcClientMetricsInterceptor,
    ]);
    expect(
      interceptorsOf(getGrpcServerOptions('booking', 'b.proto', 'x')),
    ).toEqual([grpcServerMetricsInterceptor]);
  });
});

// 실제 grpc-js 서버·클라이언트로 한 번씩 호출해 기록을 확인한다
describe('실제 호출 측정', () => {
  const json = {
    serialize: (value: unknown) => Buffer.from(JSON.stringify(value)),
    deserialize: (buffer: Buffer): unknown => JSON.parse(buffer.toString()),
  };
  const method = (name: string) => ({
    path: `/booking.BookingService/${name}`,
    requestStream: false,
    responseStream: false,
    requestSerialize: json.serialize,
    requestDeserialize: json.deserialize,
    responseSerialize: json.serialize,
    responseDeserialize: json.deserialize,
  });
  const service: ServiceDefinition = {
    GetBooking: method('GetBooking'),
    CancelBooking: method('CancelBooking'),
  };

  let metrics: AppMetrics;
  let server: Server;
  let client: Client;

  beforeAll(async () => {
    metrics = startMetrics('booking-service', 19480)!;
    server = new Server({ interceptors: [grpcServerMetricsInterceptor] });
    server.addService(service, {
      GetBooking: (
        _call: unknown,
        callback: (err: null, res: object) => void,
      ) => callback(null, { ok: true }),
      CancelBooking: (
        _call: unknown,
        callback: (err: { code: number; details: string }) => void,
      ) => callback({ code: GrpcStatus.NOT_FOUND, details: '없는 예약' }),
    });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        ServerCredentials.createInsecure(),
        (err, bound) => (err ? reject(err) : resolve(bound)),
      ),
    );
    client = new Client(`127.0.0.1:${port}`, credentials.createInsecure(), {
      interceptors: [grpcClientMetricsInterceptor],
    });
  });

  afterAll(() => {
    client.close();
    server.forceShutdown();
    metrics.server.close();
  });

  const call = (name: string) =>
    new Promise<number>((resolve) => {
      const def = method(name);
      client.makeUnaryRequest(
        def.path,
        def.requestSerialize,
        def.responseDeserialize,
        {},
        new Metadata(),
        (err) => resolve(err?.code ?? GrpcStatus.OK),
      );
    });

  const countLines = async (name: string) =>
    (await metrics.registry.metrics())
      .split('\n')
      .filter((line) => line.startsWith(`${name}_count`));

  it('서버: 받은 호출을 서비스·메서드·결과 코드별로 기록한다', async () => {
    expect(await call('GetBooking')).toBe(GrpcStatus.OK);
    expect(await call('CancelBooking')).toBe(GrpcStatus.NOT_FOUND);

    expect(await countLines('rpc_server_duration_seconds')).toEqual([
      'rpc_server_duration_seconds_count{service="booking-service",rpc_service="booking.BookingService",rpc_method="GetBooking",grpc_code="OK"} 1',
      'rpc_server_duration_seconds_count{service="booking-service",rpc_service="booking.BookingService",rpc_method="CancelBooking",grpc_code="NOT_FOUND"} 1',
    ]);
  });

  it('클라이언트: 보낸 호출을 호출 대상(peer_service)과 함께 기록한다', async () => {
    expect(await countLines('rpc_client_duration_seconds')).toEqual([
      'rpc_client_duration_seconds_count{service="booking-service",peer_service="booking-service",rpc_service="booking.BookingService",rpc_method="GetBooking",grpc_code="OK"} 1',
      'rpc_client_duration_seconds_count{service="booking-service",peer_service="booking-service",rpc_service="booking.BookingService",rpc_method="CancelBooking",grpc_code="NOT_FOUND"} 1',
    ]);
  });

  it('연결할 수 없는 상대는 UNAVAILABLE로 기록한다', async () => {
    const down = new Client('127.0.0.1:1', credentials.createInsecure(), {
      interceptors: [grpcClientMetricsInterceptor],
    });
    const def = method('GetBooking');
    const code = await new Promise<number>((resolve) =>
      down.makeUnaryRequest(
        def.path,
        def.requestSerialize,
        def.responseDeserialize,
        {},
        new Metadata(),
        { deadline: Date.now() + 2000 },
        (err) => resolve(err?.code ?? GrpcStatus.OK),
      ),
    );
    down.close();

    expect(code).toBe(GrpcStatus.UNAVAILABLE);
    expect(
      (await countLines('rpc_client_duration_seconds')).some((line) =>
        line.includes('grpc_code="UNAVAILABLE"'),
      ),
    ).toBe(true);
  });
});
