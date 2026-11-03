import * as grpc from '@grpc/grpc-js';
import { grpcDeadlineInterceptor } from './grpc-deadline';

// LDP-223: 실제 grpc-js 서버·클라이언트로, 인터셉터가 건 기한에 호출이 끊기는지 확인한다
const json = {
  serialize: (value: unknown) => Buffer.from(JSON.stringify(value ?? {})),
  deserialize: (buffer: Buffer) => JSON.parse(buffer.toString()) as unknown,
};

function method(path: string) {
  return {
    path,
    requestStream: false,
    responseStream: false,
    requestSerialize: json.serialize,
    requestDeserialize: json.deserialize,
    responseSerialize: json.serialize,
    responseDeserialize: json.deserialize,
  };
}

const definition = {
  Hang: method('/test.TestService/Hang'),
  Slow: method('/test.TestService/Slow'),
};

type UnaryCall = (
  request: unknown,
  options: grpc.CallOptions,
  callback: (error: grpc.ServiceError | null) => void,
) => void;

describe('grpcDeadlineInterceptor', () => {
  let server: grpc.Server;
  let client: grpc.Client & { Hang: UnaryCall; Slow: UnaryCall };

  beforeAll(async () => {
    server = new grpc.Server();
    // 두 메서드 모두 응답하지 않는다 (꺼지는 중인 Pod처럼)
    server.addService(definition, { Hang: () => {}, Slow: () => {} });
    const port = await new Promise<number>((resolve, reject) =>
      server.bindAsync(
        '127.0.0.1:0',
        grpc.ServerCredentials.createInsecure(),
        (error, boundPort) => (error ? reject(error) : resolve(boundPort)),
      ),
    );
    const Client = grpc.makeGenericClientConstructor(definition, 'TestService');
    client = new Client(
      `127.0.0.1:${port}`,
      grpc.credentials.createInsecure(),
      {
        interceptors: [
          grpcDeadlineInterceptor(200, { '/test.TestService/Slow': 600 }),
        ],
      },
    ) as unknown as typeof client;
  });

  afterAll(() => {
    client.close();
    server.forceShutdown();
  });

  // 호출이 끝날 때의 에러 코드와 걸린 시간(ms)
  function call(
    name: 'Hang' | 'Slow',
    options: grpc.CallOptions = {},
  ): Promise<{ code?: grpc.status; elapsed: number }> {
    const started = Date.now();
    return new Promise((resolve) =>
      client[name]({}, options, (error) =>
        resolve({ code: error?.code, elapsed: Date.now() - started }),
      ),
    );
  }

  it('응답이 없으면 기본 기한에 DEADLINE_EXCEEDED로 끝난다', async () => {
    const { code, elapsed } = await call('Hang');

    expect(code).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(500);
  });

  it('경로별 기한이 있으면 그 값을 쓴다', async () => {
    const { code, elapsed } = await call('Slow');

    expect(code).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(elapsed).toBeGreaterThanOrEqual(550);
  });

  it('호출하는 쪽이 넘긴 기한은 바꾸지 않는다', async () => {
    const { code, elapsed } = await call('Hang', {
      deadline: Date.now() + 500,
    });

    expect(code).toBe(grpc.status.DEADLINE_EXCEEDED);
    expect(elapsed).toBeGreaterThanOrEqual(450);
  });
});
