// libs/common/src/grpc/grpc-options.ts
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

// gRPC 로드 밸런싱 (LDP-159).
// gRPC는 연결 하나를 오래 재사용하는데, 쿠버네티스 기본 Service(ClusterIP)는 연결을 맺을 때만 Pod를 고른다(L4).
// 그래서 레플리카가 2대여도 요청이 처음 연결된 Pod 한 대로만 간다. 아래 두 옵션으로 요청 단위로 나눈다.
//  - 클라이언트: 주소가 `dns:///<서비스>-headless:<포트>`(Headless Service)이면 DNS로 Pod 주소 목록을 받아
//    요청마다 돌아가며 보낸다(round_robin). 주소가 `user-service:3001`처럼 하나뿐이면 지금과 똑같이 그 주소 하나로 간다.
//  - 서버: 연결을 일정 시간마다 정리(GOAWAY)해서, 클라이언트가 다시 연결하며 DNS를 새로 조회하게 한다
//    → HPA로 새로 뜬 Pod도 몇 분 안에 분배 대상이 된다. 처리 중인 요청은 grace 시간 안에 마무리한다.
// 서버·클라이언트가 같은 함수를 쓰므로 두 옵션을 함께 넣는다 (각자 자기에게 해당하는 옵션만 쓰고 나머지는 무시).
const DEFAULT_MAX_CONNECTION_AGE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONNECTION_AGE_GRACE_MS = 30 * 1000;

// 양의 정수 환경변수 (없거나 잘못되면 기본값)
function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function grpcChannelOptions(): Record<string, string | number> {
  return {
    // 클라이언트: 받은 주소 목록에 요청을 번갈아 보낸다 (grpc-js 기본은 첫 주소 하나만 쓰는 pick_first)
    'grpc.service_config': JSON.stringify({
      loadBalancingConfig: [{ round_robin: {} }],
    }),
    // 서버: 연결 수명과, 정리할 때 처리 중인 요청을 기다리는 시간
    'grpc.max_connection_age_ms': positiveIntEnv(
      'GRPC_MAX_CONNECTION_AGE_MS',
      DEFAULT_MAX_CONNECTION_AGE_MS,
    ),
    'grpc.max_connection_age_grace_ms': positiveIntEnv(
      'GRPC_MAX_CONNECTION_AGE_GRACE_MS',
      DEFAULT_MAX_CONNECTION_AGE_GRACE_MS,
    ),
  };
}

// 👇 export 키워드가 필수입니다!
export function getGrpcOptions(
  packageName: string,
  protoFile: string,
  url: string,
): GrpcOptions {
  return {
    transport: Transport.GRPC,
    options: {
      package: packageName,
      protoPath: join(process.cwd(), 'dist/libs/common/proto', protoFile),
      url: url,
      loader: {
        // proto-loader 기본값(false)이면 빈 배열/0/빈 문자열 같은 proto3 "기본값" 필드가
        // 디코딩된 객체에서 통째로 생략된다 (예: 객실이 0개인 호텔의 GetRooms 응답에 rooms 키 자체가 없어짐).
        defaults: true,
      },
      channelOptions: grpcChannelOptions(),
    },
  };
}
