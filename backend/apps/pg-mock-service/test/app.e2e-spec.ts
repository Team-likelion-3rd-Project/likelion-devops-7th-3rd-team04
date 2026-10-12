import { Server } from 'http';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { PgMockServiceModule } from './../src/pg-mock-service.module';
import { PaymentRecord } from '../src/payments/payment-record.interface';

describe('PG Mock Service (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;

  beforeEach(async () => {
    delete process.env.PAYMENT_SERVICE_WEBHOOK_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PgMockServiceModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });

  afterEach(async () => {
    await app.close();
  });

  it('결제 생성 → 승인 → 취소 → 단건 조회 순으로 정상 동작한다', async () => {
    const createRes = await request(httpServer)
      .post('/payments')
      .send({
        orderId: 'order_e2e_0001',
        amount: 50000,
        orderName: '더블룸 1박',
        paymentMethod: 'CARD',
      })
      .expect(201);

    const created = createRes.body as PaymentRecord;
    expect(created.status).toBe('READY');

    const approveRes = await request(httpServer)
      .post(`/payments/${created.paymentKey}/approve`)
      .expect(201);
    const approved = approveRes.body as PaymentRecord;
    expect(approved.status).toBe('DONE');
    expect(approved.approvalNumber).toMatch(/^\d{8}$/);

    const cancelRes = await request(httpServer)
      .post(`/payments/${created.paymentKey}/cancel`)
      .send({ cancelReason: '고객 변심' })
      .expect(201);
    expect((cancelRes.body as PaymentRecord).status).toBe('CANCELED');

    const getRes = await request(httpServer)
      .get(`/payments/${created.paymentKey}`)
      .expect(200);
    expect((getRes.body as PaymentRecord).status).toBe('CANCELED');
  });

  it('X-Mock-Result: fail 헤더를 보내면 승인이 실패한다', async () => {
    const createRes = await request(httpServer)
      .post('/payments')
      .send({
        orderId: 'order_e2e_0002',
        amount: 50000,
        orderName: '더블룸 1박',
        paymentMethod: 'CARD',
      })
      .expect(201);

    const created = createRes.body as PaymentRecord;

    await request(httpServer)
      .post(`/payments/${created.paymentKey}/approve`)
      .set('X-Mock-Result', 'fail')
      .expect(400);
  });
});
