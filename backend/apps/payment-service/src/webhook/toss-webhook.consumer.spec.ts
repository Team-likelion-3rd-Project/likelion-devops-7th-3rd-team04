import { DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { TossWebhookConsumer } from './toss-webhook.consumer';
import { TossWebhookInboxService } from './toss-webhook-inbox.service';

describe('TossWebhookConsumer', () => {
  const record = jest.fn();
  const send = jest.fn();
  let consumer: TossWebhookConsumer;

  const createConsumer = () =>
    new TossWebhookConsumer(
      { record } as unknown as TossWebhookInboxService,
      { send } as never,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_WEBHOOK_QUEUE_URL =
      'http://elasticmq:9324/000000000000/payment-webhook';
    consumer = createConsumer();
  });

  afterAll(() => {
    delete process.env.PAYMENT_WEBHOOK_QUEUE_URL;
  });

  const message = {
    headers: { 'tosspayments-webhook-transmission-id': 't1' },
    body: {
      eventType: 'PAYMENT_STATUS_CHANGED',
      data: { paymentKey: 'pay_1', status: 'DONE' },
    },
  };

  it('저장에 성공하면 메시지를 큐에서 지운다', async () => {
    record.mockResolvedValue(undefined);
    send.mockResolvedValue({});

    await consumer.handle({
      Body: JSON.stringify(message),
      ReceiptHandle: 'rh-1',
    });

    expect(record).toHaveBeenCalledWith(message);
    const [command] = send.mock.calls[0] as [DeleteMessageCommand];
    expect(command).toBeInstanceOf(DeleteMessageCommand);
    expect(command.input.ReceiptHandle).toBe('rh-1');
  });

  it('저장에 실패하면 지우지 않는다 (큐가 다시 보내고, 5번 실패하면 DLQ)', async () => {
    record.mockRejectedValue(new Error('db down'));

    await consumer.handle({
      Body: JSON.stringify(message),
      ReceiptHandle: 'rh-1',
    });

    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    ['JSON이 아닌 메시지', 'not-json'],
    ['body가 문자열인 메시지', JSON.stringify({ body: '{"eventType":"x"}' })],
    ['body가 없는 메시지', JSON.stringify({ headers: {} })],
    ['null 메시지', 'null'],
  ])('%s는 저장하지도 지우지도 않는다 (DLQ로 가게 둠)', async (_, Body) => {
    await consumer.handle({ Body, ReceiptHandle: 'rh-1' });

    expect(record).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('큐 주소가 없으면 수신을 시작하지 않는다', () => {
    delete process.env.PAYMENT_WEBHOOK_QUEUE_URL;

    createConsumer().onApplicationBootstrap();

    expect(send).not.toHaveBeenCalled();
  });
});
