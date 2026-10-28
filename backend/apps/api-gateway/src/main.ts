import { NestFactory } from '@nestjs/core';
import { httpMetricsMiddleware, startMetrics } from '@app/common';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { ApiGatewayModule } from './api-gateway.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(ApiGatewayModule);

  // K8s가 pod를 종료할 때(스케일다운/재배포) 보내는 SIGTERM을 Nest가 받아서 처리하게
  // 한다. 이게 없으면 Node 프로세스가 SIGTERM에 기본 동작(즉시 종료)으로 반응해서,
  // 그 순간 처리 중이던 요청이 커넥션 리셋으로 그대로 끊긴다 — 부하테스트 중 HPA
  // 스케일다운 때마다 pod가 Terminating -> Error로 죽은 것과 이 요청 실패가 겹쳐서
  // 관찰됐다. enableShutdownHooks()로 onModuleDestroy 라이프사이클을 활성화하면
  // 최소한 진행 중인 연결을 정리할 기회가 생긴다(deployment.yaml의
  // terminationGracePeriodSeconds/preStop과 세트로 동작).
  app.enableShutdownHooks();

  // Prometheus 메트릭 (LDP-168). METRICS_PORT가 있을 때만 /metrics 서버를 띄우고 HTTP 요청을 측정한다.
  // 본문 파싱·CORS보다 먼저 등록해서 413(본문 초과)·404·가드에서 막힌 401/429까지 센다
  const metrics = startMetrics('api-gateway');
  if (metrics) {
    app.use(httpMetricsMiddleware(metrics.registry));
  }

  // 요청 본문 최대 크기 1MB (LDP-134). 넘으면 413(Payload Too Large).
  // 예전에는 객실 사진을 base64 JSON으로 받느라 20MB까지 열어 두었지만, 지금 사진은 브라우저가 Presigned URL로
  // 저장소(MinIO·S3)에 직접 올리므로(LDP-88) gateway에는 몇 KB짜리 JSON만 온다. 큰 본문을 받아 메모리를 쓰지 않게 줄인다.
  // (운영은 앞단 WAF가 본문을 더 작게 막는다 — infra/terraform/live/prod/80-main-edge/waf.tf)
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  // 로그인 시 발급되는 httpOnly 쿠키(refreshToken)를 req.cookies로 파싱합니다.
  app.use(cookieParser());

  app.enableCors({
    // DEV-171: 로컬 개발은 기존처럼 5173, 배포 환경은 CORS_ORIGIN env var(예: prod는
    // https://www.team04-hotel-prod.kro.kr)로 오버라이드. gitops/backend/overlays/{dev,prod}/
    // api-gateway-cors-patch.yaml에서 환경별로 설정.
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    // 프론트가 fetch(..., { credentials: 'include' })로 보내는 httpOnly 쿠키를 주고받으려면 필수
    credentials: true,
  });

  // DTO(class-validator)로 정의한 유효성 검사 규칙을 전역 적용 (회원가입 등)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO에 없는 필드는 제거
      forbidNonWhitelisted: true, // DTO에 없는 필드가 오면 400 에러
      transform: true, // payload를 DTO 클래스 인스턴스로 변환
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('RAG 기반 챗봇 호텔 예약 웹서비스 API')
    .setDescription('API Gateway Swagger 문서입니다.')
    .setVersion('1.0')
    .addBearerAuth() // JWT 토큰 인증 (로그아웃 등 @ApiBearerAuth() 라우트에서 Swagger의 Authorize 버튼 사용)
    .build();

  const document = SwaggerModule.createDocument(app, config);
  // http://localhost:3000/api-docs 로 접속하도록 설정
  SwaggerModule.setup('api-docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
