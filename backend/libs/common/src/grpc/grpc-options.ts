// libs/common/src/grpc/grpc-options.ts
import { GrpcOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';

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
      // Base64로 인코딩한 이미지처럼 큰 페이로드(객실 이미지 등)를 gRPC로 주고받을 수 있도록
      // grpc-js 기본 4MB 제한을 넉넉하게 상향한다.
      maxSendMessageLength: 20 * 1024 * 1024,
      maxReceiveMessageLength: 20 * 1024 * 1024,
    },
  };
}
