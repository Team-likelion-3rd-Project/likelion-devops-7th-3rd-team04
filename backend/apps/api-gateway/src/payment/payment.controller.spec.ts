import { createHmac } from 'crypto';
import type { Request } from 'express';
import { Test, TestingModule } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '@app/common';
import { PaymentController } from './payment.controller';

describe('PaymentController', () => {
  let controller: PaymentController;

  const getHelloMock = jest.fn();
  const requestPaymentMock = jest.fn();
  const handlePaymentWebhookMock = jest.fn();

  const user: AuthenticatedUser = {
    userId: 10,
    email: 'user@example.com',
    role: 'USER',
    type: 'USER',
  };

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
              requestPayment: requestPaymentMock,
              handlePaymentWebhook: handlePaymentWebhookMock,
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<PaymentController>(PaymentController);
    controller.onModuleInit();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('requestPayment', () => {
    it('결제 성공 시 payment-service의 응답을 그대로 반환한다', async () => {
      const payment = {
        paymentId: 1,
        reservationId: 5,
        approvalNumber: '12345678',
        amount: 50000,
        paymentMethod: 'CARD',
        status: 'paid',
        paidAt: '2026-08-18T02:00:05.000Z',
      };
      requestPaymentMock.mockReturnValue(of(payment));

      const result = await controller.requestPayment(user, {
        reservationId: 5,
        paymentMethod: 'CARD',
      });

      expect(requestPaymentMock).toHaveBeenCalledWith({
        reservationId: 5,
        paymentMethod: 'CARD',
        userId: 10,
      });
      expect(result).toEqual(payment);
    });

    it('"존재하지 않는 예약" 에러는 404로 변환한다', async () => {
      requestPaymentMock.mockReturnValue(
        throwError(() => ({ message: '존재하지 않는 예약입니다.' })),
      );

      await expect(
        controller.requestPayment(user, {
          reservationId: 999,
          paymentMethod: 'CARD',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('"본인의 예약만" 에러는 403으로 변환한다', async () => {
      requestPaymentMock.mockReturnValue(
        throwError(() => ({ message: '본인의 예약만 결제할 수 있습니다.' })),
      );

      await expect(
        controller.requestPayment(user, {
          reservationId: 5,
          paymentMethod: 'CARD',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('"이미 결제" 에러는 409로 변환한다', async () => {
      requestPaymentMock.mockReturnValue(
        throwError(() => ({ message: '이미 결제된 예약입니다.' })),
      );

      await expect(
        controller.requestPayment(user, {
          reservationId: 5,
          paymentMethod: 'CARD',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('그 외 에러는 502로 변환한다', async () => {
      requestPaymentMock.mockReturnValue(
        throwError(() => ({ message: '결제 승인에 실패했습니다.' })),
      );

      await expect(
        controller.requestPayment(user, {
          reservationId: 5,
          paymentMethod: 'CARD',
        }),
      ).rejects.toThrow(BadGatewayException);
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
