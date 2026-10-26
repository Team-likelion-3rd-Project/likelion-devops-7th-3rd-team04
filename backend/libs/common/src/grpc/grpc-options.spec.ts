import { getGrpcOptions, grpcChannelOptions } from './grpc-options';

// LDP-159: gRPC 로드 밸런싱 — 클라이언트 round_robin, 서버 연결 수명
describe('getGrpcOptions', () => {
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.GRPC_MAX_CONNECTION_AGE_MS;
    delete process.env.GRPC_MAX_CONNECTION_AGE_GRACE_MS;
  });

  afterAll(() => {
    process.env = env;
  });

  it('서버·클라이언트 모두 같은 채널 옵션을 받는다 (주소·패키지는 그대로)', () => {
    const options = getGrpcOptions('booking', 'booking.proto', 'localhost:3003')
      .options as Record<string, unknown>;

    expect(options.url).toBe('localhost:3003');
    expect(options.package).toBe('booking');
    expect(options.channelOptions).toEqual(grpcChannelOptions());
  });

  it('클라이언트는 받은 주소 목록에 요청을 번갈아 보낸다 (round_robin)', () => {
    const serviceConfig = JSON.parse(
      grpcChannelOptions()['grpc.service_config'] as string,
    ) as { loadBalancingConfig: Record<string, unknown>[] };

    expect(serviceConfig.loadBalancingConfig).toEqual([{ round_robin: {} }]);
  });

  it('서버 연결 수명 기본값: 5분, 정리 대기 30초', () => {
    expect(grpcChannelOptions()).toMatchObject({
      'grpc.max_connection_age_ms': 300000,
      'grpc.max_connection_age_grace_ms': 30000,
    });
  });

  it('연결 수명은 환경변수로 바꿀 수 있고, 잘못된 값이면 기본값', () => {
    process.env.GRPC_MAX_CONNECTION_AGE_MS = '60000';
    process.env.GRPC_MAX_CONNECTION_AGE_GRACE_MS = 'abc';

    expect(grpcChannelOptions()).toMatchObject({
      'grpc.max_connection_age_ms': 60000,
      'grpc.max_connection_age_grace_ms': 30000,
    });
  });
});
