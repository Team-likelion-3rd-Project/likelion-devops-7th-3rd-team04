import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AuthServiceModule } from './../src/auth-service.module';

// 참고: AuthServiceModule은 부팅 시 실제 MariaDB에 연결하므로
// 로컬 DB(docker-compose)가 떠 있어야 통과합니다. (user-service e2e 테스트와 동일한 전제)
describe('AuthServiceController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AuthServiceModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  // AuthService는 gRPC 전용이라 등록된 HTTP 라우트가 없으므로 404가 기대값입니다.
  it('/ (GET) - HTTP 라우트 없음 (gRPC 전용 서비스)', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });
});
