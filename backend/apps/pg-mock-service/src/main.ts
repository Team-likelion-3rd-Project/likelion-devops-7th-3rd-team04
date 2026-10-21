import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { PgMockServiceModule } from './pg-mock-service.module';

// PG 목업 서버는 다른 내부 서비스와 달리 gRPC가 아닌 순수 HTTP로 띄웁니다.
// 실제 PG사(토스페이먼츠 등)는 REST API + 웹훅으로 연동하므로, payment-service가
// 실제 PG를 붙일 때와 동일한 방식(HTTP)으로 이 목업 서버를 호출하게 하기 위함입니다.
async function bootstrap() {
  const app = await NestFactory.create(PgMockServiceModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('PG 목업 서버 API')
    .setDescription(
      '실제 PG사 서버를 대신하는 목업 서버입니다. payment-service가 이 서버를 상대로 결제 생성/승인/취소를 요청하고, 이 서버는 결과를 웹훅으로 통보합니다.',
    )
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  // http://localhost:3007/api-docs
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT ?? 3007;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
