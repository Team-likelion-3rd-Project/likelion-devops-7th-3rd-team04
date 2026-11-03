import { createHmac } from 'crypto';
import type { Request } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { status as GrpcStatus } from '@grpc/grpc-js';
import { BadRequestException } from '@nestjs/common';
import { PaymentController } from './payment.controller';

describe('PaymentController', () => {
  let controller: PaymentController;

  const getHelloMock = jest.fn();
  const handlePaymentWebhookMock = jest.fn();
  const getPaymentsByUserIdMock = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    getHelloMock.mockReturnValue(of({ message: 'Payment Hello World!' }));

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentController],
      providers: [
        {
          provide: 'PAYMENT_SERVICE',
          useValue: {
            getService: () => ({
              getHello: getHelloMock,
              handlePaymentWebhook: handlePaymentWebhookMock,
              getPaymentsByUserId: getPaymentsByUserIdMock,
            }),
          },
        },
        // 관리자 결제 조회의 지점 확인용 (LDP-178)
        { provide: 'BOOKING_SERVICE', useValue: { getService: () => ({}) } },
      ],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  // LDP-198: catch가 없어 500으로 나가던 것을 일시 장애(503)로
  describe('getMyPayments', () => {
    it('결제 서비스 장애면 503 PAYMENT_SERVICE_UNAVAILABLE', async () => {
      getPaymentsByUserIdMock.mockReturnValue(
        throwError(() => ({ code: GrpcStatus.UNAVAILABLE })),
      );

      await expect(
        controller.getMyPayments({ userId: 1 } as never),
      ).rejects.toMatchObject({
        status: 503,
        response: {
          code: 'PAYMENT_SERVICE_UNAVAILABLE',
          retryable: true,
        },
      });
    });
  });

  describe('handleWebhook', () => {
    const payload = {
      eventType: 'PAYMENT.APPROVED',
      paymentKey: 'pgmock_1',
      orderId: '5',
      amount: 50000,
      paymentMethod: 'CARD',
      approvalNumber: '12345678',
      status: 'DONE',
      occurredAt: '2026-08-18T02:00:05.000Z',
    };

    const sign = (body: Record<string, unknown>) =>
      createHmac('sha256', process.env.MOCK_PG_SECRET || 'mock-pg-secret')
        .update(JSON.stringify(body))
        .digest('hex');

    it('서명이 유효하면 payment-service에 위임하고 수신 확인을 반환한다', async () => {
      const signature = sign(payload);
      handlePaymentWebhookMock.mockReturnValue(of({}));

      const result = await controller.handleWebhook(
        { body: { ...payload, signature } } as unknown as Request,
        { ...payload, signature },
      );

      expect(handlePaymentWebhookMock).toHaveBeenCalledWith(payload);
      expect(result).toEqual({ received: true });
    });

    it('서명이 없으면 BadRequestException을 던진다', async () => {
      await expect(
        controller.handleWebhook(
          { body: { ...payload } } as unknown as Request,
          { ...payload, signature: '' },
        ),
      ).rejects.toThrow(BadRequestException);

      expect(handlePaymentWebhookMock).not.toHaveBeenCalled();
    });

    it('서명이 틀리면 BadRequestException을 던진다', async () => {
      const rawBody = { ...payload, signature: 'invalid-signature' };

      await expect(
        controller.handleWebhook(
          { body: rawBody } as unknown as Request,
          rawBody,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(handlePaymentWebhookMock).not.toHaveBeenCalled();
    });
  });
});
