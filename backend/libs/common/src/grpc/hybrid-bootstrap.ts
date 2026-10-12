import { INestApplication, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';

// gRPC 전용 서비스를 "gRPC + HTTP(헬스체크용)" 하이브리드 앱으로 띄웁니다.
// gRPC는 HTTP GET 요청을 받을 수 없어서, docker-compose healthcheck/K8s probe가 호출할
// GET /health를 위해 별도 HTTP 포트(healthPort)를 하나 더 엽니다. 이 포트는 컨테이너
// 내부에서만 쓰므로 docker-compose의 ports:로 외부에 노출하지 않습니다.
export async function bootstrapGrpcWithHealth(
  module: Type<unknown>,
  grpcOptions: MicroserviceOptions,
  healthPort: number,
): Promise<INestApplication> {
  const app = await NestFactory.create(module);
  app.connectMicroservice<MicroserviceOptions>(grpcOptions);

  // SIGTERM 시 진행 중인 gRPC 요청을 마무리할 기회를 준다(deployment.yaml의
  // terminationGracePeriodSeconds/preStop과 세트). api-gateway/src/main.ts 주석 참고.
  app.enableShutdownHooks();

  await app.startAllMicroservices();
  await app.listen(process.env.HEALTH_PORT ?? healthPort, '0.0.0.0');
  return app;
}
