import { Test, TestingModule } from '@nestjs/testing';
import { PaymentServiceController } from './payment-service.controller';
import { PaymentServiceService } from './payment-service.service';

describe('PaymentServiceController', () => {
  let controller: PaymentServiceController;

  const getHelloMock = jest.fn();
  const requestPaymentMock = jest.fn();
  const handlePaymentWebhookMock = jest.fn();

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentServiceController],
      providers: [
        {
          provide: PaymentServiceService,
          useValue: {
            getHello: getHelloMock,
            requestPayment: requestPaymentMock,
            handlePaymentWebhook: handlePaymentWebhookMock,
          },
        },
      ],
    }).compile();

    controller = module.get<PaymentServiceController>(PaymentServiceController);
  });

  it('getHello는 서비스의 getHello 결과를 message로 감싸 반환한다', () => {
    getHelloMock.mockReturnValue('Payment Hello World!');

    expect(controller.getHello()).toEqual({
      message: 'Payment Hello World!',
    });
  });

  it('requestPayment는 서비스의 requestPayment에 위임한다', async () => {
    const data = { reservationId: 1, userId: 2, paymentMethod: 'CARD' };
    requestPaymentMock.mockResolvedValue({ paymentId: 1 });

    await controller.requestPayment(data);

    expect(requestPaymentMock).toHaveBeenCalledWith(data);
  });

  it('handlePaymentWebhook은 서비스에 위임하고 빈 객체를 반환한다', async () => {
    const data = {
      eventType: 'PAYMENT.APPROVED',
      paymentKey: 'pgmock_1',
      orderId: '1',
      amount: 50000,
      paymentMethod: 'CARD',
      approvalNumber: '12345678',
      status: 'DONE',
      occurredAt: '2026-08-18T02:00:05.000Z',
    };
    handlePaymentWebhookMock.mockResolvedValue(undefined);

    const result = await controller.handlePaymentWebhook(data);

    expect(handlePaymentWebhookMock).toHaveBeenCalledWith(data);
    expect(result).toEqual({});
  });
});
