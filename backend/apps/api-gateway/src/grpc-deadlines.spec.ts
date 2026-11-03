import { loadSync } from '@grpc/proto-loader';
import { join } from 'path';
import {
  GRPC_DEADLINE_MS_BY_PATH,
  getGatewayGrpcOptions,
} from './grpc-deadlines';

// LDP-223: api-gateway gRPC 호출 기한
describe('api-gateway gRPC 호출 기한', () => {
  it('클라이언트 옵션에 기한 인터셉터가 들어간다', () => {
    const options = getGatewayGrpcOptions('hotel', 'hotel.proto', ':3002')
      .options as { channelOptions: { interceptors?: unknown[] } };

    expect(options.channelOptions.interceptors).toHaveLength(1);
  });

  it('경로별 기한의 경로는 모두 proto에 있는 메서드다 (오타면 기본 5초가 걸린다)', () => {
    const protoDir = join(__dirname, '../../../libs/common/src/proto');
    const definitions = loadSync(
      ['auth.proto', 'booking.proto', 'chat-bot.proto'].map((file) =>
        join(protoDir, file),
      ),
    );
    const paths = Object.values(definitions).flatMap((service) =>
      Object.values(service).map((m: { path?: string }) => m.path),
    );

    for (const path of Object.keys(GRPC_DEADLINE_MS_BY_PATH)) {
      expect(paths).toContain(path);
    }
  });
});
