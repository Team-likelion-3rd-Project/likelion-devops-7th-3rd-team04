import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { configureTrustProxy } from './trust-proxy';

@Controller()
class ThrottledController {
  @Get('limited')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  limited() {
    return 'ok';
  }
}

// ThrottlerGuard가 X-Forwarded-For의 클라이언트 IP별로 버킷을 나누는지 확인합니다.
// supertest는 127.0.0.1(loopback, 신뢰 대상)에서 접속하므로 Traefik 뒤에 있는 상황과 같습니다.
describe('configureTrustProxy', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
      ],
      controllers: [ThrottledController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureTrustProxy(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const call = (xff: string) =>
    request(app.getHttpServer()).get('/limited').set('X-Forwarded-For', xff);

  it('클라이언트 IP별로 따로 센다', async () => {
    await call('203.0.113.1').expect(200);
    await call('203.0.113.1').expect(200);
    await call('203.0.113.1').expect(429);

    await call('203.0.113.2').expect(200);
  });

  it('XFF 왼쪽을 바꿔도 프록시가 붙인 클라이언트 IP로 센다', async () => {
    await call('1.1.1.1, 203.0.113.1').expect(200);
    await call('8.8.8.8, 203.0.113.1').expect(200);
    await call('9.9.9.9, 203.0.113.1, 10.10.1.5').expect(429);
  });
});
