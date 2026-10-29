import { Controller, Get } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { DEFAULT_THROTTLE_LIMIT, throttleLimitFromEnv } from './throttle-limit';

@Controller()
class ThrottledController {
  @Get('default')
  byDefault() {
    return 'ok';
  }

  // 토큰 재발급·챗봇처럼 라우트에서 따로 정한 한도
  @Get('override')
  @Throttle({ default: { limit: 2, ttl: 60_000 } })
  override() {
    return 'ok';
  }
}

describe('throttleLimitFromEnv', () => {
  const original = process.env.THROTTLE_LIMIT;
  afterEach(() => {
    if (original === undefined) {
      delete process.env.THROTTLE_LIMIT;
    } else {
      process.env.THROTTLE_LIMIT = original;
    }
  });

  it('없으면 기본 100', () => {
    delete process.env.THROTTLE_LIMIT;
    expect(throttleLimitFromEnv()).toBe(DEFAULT_THROTTLE_LIMIT);
    expect(DEFAULT_THROTTLE_LIMIT).toBe(100);
  });

  it('1 이상의 정수면 그 값', () => {
    process.env.THROTTLE_LIMIT = '1000000';
    expect(throttleLimitFromEnv()).toBe(1_000_000);
  });

  it.each(['', '0', '-5', '1.5', 'abc'])(
    '잘못된 값(%p)이면 기본 100',
    (value) => {
      process.env.THROTTLE_LIMIT = value;
      expect(throttleLimitFromEnv()).toBe(DEFAULT_THROTTLE_LIMIT);
    },
  );
});

// api-gateway.module.ts와 같은 설정으로 ThrottlerGuard를 띄워, 같은 IP에서 보낸 요청이 한도대로 막히는지 확인합니다.
describe('THROTTLE_LIMIT 적용', () => {
  let app: NestExpressApplication;

  const start = async (limit: number) => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit }]),
      ],
      controllers: [ThrottledController],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
  };

  afterEach(async () => {
    await app?.close();
    delete process.env.THROTTLE_LIMIT;
  });

  // 순서대로 보내야 몇 번째에서 막혔는지 알 수 있다
  const callTimes = async (path: string, times: number) => {
    const statuses: number[] = [];
    for (let i = 0; i < times; i++) {
      statuses.push((await request(app.getHttpServer()).get(path)).status);
    }
    return statuses;
  };

  it('미설정이면 분당 100회를 넘는 101번째 요청이 429', async () => {
    await start(throttleLimitFromEnv());
    const statuses = await callTimes('/default', 101);
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses[100]).toBe(429);
  });

  it('THROTTLE_LIMIT=1000이면 100회를 넘게 불러도 정상 응답', async () => {
    process.env.THROTTLE_LIMIT = '1000';
    await start(throttleLimitFromEnv());
    const statuses = await callTimes('/default', 101);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it('@Throttle로 따로 정한 라우트의 한도는 바뀌지 않는다', async () => {
    process.env.THROTTLE_LIMIT = '1000';
    await start(throttleLimitFromEnv());
    expect(await callTimes('/override', 3)).toEqual([200, 200, 429]);
  });
});
