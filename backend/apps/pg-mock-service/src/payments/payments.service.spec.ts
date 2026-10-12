import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const createDto: CreatePaymentDto = {
    orderId: 'order_test_0001',
    amount: 50000,
    orderName: '더블룸 1박',
    paymentMethod: 'CARD',
  };

  beforeEach(async () => {
    // PAYMENT_SERVICE_WEBHOOK_URL을 비워두면 sendWebhook이 조기 반환하므로
    // 테스트에서 실제 네트워크 호출이 발생하지 않습니다.
    delete process.env.PAYMENT_SERVICE_WEBHOOK_URL;

    const module: TestingModule = await Test.createTestingModule({
      imports: [HttpModule],
      providers: [PaymentsService],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('결제 요청을 READY 상태로 생성한다', () => {
    const record = service.create(createDto);

    expect(record.status).toBe('READY');
    expect(record.paymentKey).toMatch(/^pgmock_/);
    expect(record.orderId).toBe(createDto.orderId);
    expect(record.amount).toBe(createDto.amount);
    expect(record.paymentMethod).toBe(createDto.paymentMethod);
    expect(record.approvalNumber).toBeUndefined();
  });

  it('READY 상태의 결제를 승인하면 DONE으로 바뀌고 승인번호가 발급된다', () => {
    const created = service.create(createDto);

    const approved = service.approve(created.paymentKey);

    expect(approved.status).toBe('DONE');
    expect(approved.approvedAt).toBeDefined();
    expect(approved.approvalNumber).toMatch(/^\d{8}$/);
  });

  it('이미 승인된 결제를 다시 승인하려 하면 ConflictException을 던진다', () => {
    const created = service.create(createDto);
    service.approve(created.paymentKey);

    expect(() => service.approve(created.paymentKey)).toThrow(
      ConflictException,
    );
  });

  it('X-Mock-Result: fail이면 BadRequestException을 던지고 상태는 READY를 유지한다', () => {
    const created = service.create(createDto);

    expect(() => service.approve(created.paymentKey, 'fail')).toThrow(
      BadRequestException,
    );
    expect(service.findOne(created.paymentKey).status).toBe('READY');
  });

  it('존재하지 않는 paymentKey를 조회하면 NotFoundException을 던진다', () => {
    expect(() => service.findOne('pgmock_존재하지-않음')).toThrow(
      NotFoundException,
    );
  });

  it('DONE 상태의 결제를 취소하면 CANCELED로 바뀐다', () => {
    const created = service.create(createDto);
    service.approve(created.paymentKey);

    const canceled = service.cancel(created.paymentKey, {
      cancelReason: '고객 변심',
    });

    expect(canceled.status).toBe('CANCELED');
    expect(canceled.canceledAt).toBeDefined();
    expect(canceled.cancelReason).toBe('고객 변심');
  });

  it('READY 상태(미승인)의 결제는 취소할 수 없다', () => {
    const created = service.create(createDto);

    expect(() => service.cancel(created.paymentKey, {})).toThrow(
      ConflictException,
    );
  });
});
