import { DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { PaymentResultConsumer } from './payment-result.consumer';
import { BookingServiceService } from '../booking-service.service';

describe('PaymentResultConsumer', () => {
  const applyPaymentResult = jest.fn();
  const send = jest.fn();
  let consumer: PaymentResultConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_RESULT_QUEUE_URL =
      'http://elasticmq:9324/000000000000/payment-result.fifo';
    consumer = new PaymentResultConsumer(
      { applyPaymentResult } as unknown as BookingServiceService,
      { send } as never,
    );
  });

  afterAll(() => {
    delete process.env.PAYMENT_RESULT_QUEUE_URL;
  });

  const event = {
    eventId: 'e1',
    eventType: 'PAYMENT_APPROVED',
    reservationId: 1,
    paymentId: 1,
    orderId: 'rsv1-abc',
    amount: 100000,
    retryable: false,
    occurredAt: '2026-10-15T00:00:00.000Z',
  };

  it('반영에 성공하면 메시지를 큐에서 지운다', async () => {
    applyPaymentResult.mockResolvedValue(undefined);
    send.mockResolvedValue({});

    await consumer.handle({
      Body: JSON.stringify(event),
      ReceiptHandle: 'rh-1',
    });

    expect(applyPaymentResult).toHaveBeenCalledWith(event);
    const [command] = send.mock.calls[0] as [DeleteMessageCommand];
    expect(command).toBeInstanceOf(DeleteMessageCommand);
    expect(command.input.ReceiptHandle).toBe('rh-1');
  });

  it('반영에 실패하면 지우지 않는다 (큐가 다시 보내고, 5번 실패하면 DLQ)', async () => {
    applyPaymentResult.mockRejectedValue(new Error('db down'));

    await consumer.handle({
      Body: JSON.stringify(event),
      ReceiptHandle: 'rh-1',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it('형식이 깨진 메시지는 반영하지도 지우지도 않는다 (DLQ로 가게 둠)', async () => {
    await consumer.handle({ Body: 'not-json', ReceiptHandle: 'rh-1' });

    expect(applyPaymentResult).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
