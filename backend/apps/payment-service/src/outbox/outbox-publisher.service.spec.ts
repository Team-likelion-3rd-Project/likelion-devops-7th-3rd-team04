import { SendMessageCommand } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { OutboxPublisherService } from './outbox-publisher.service';

describe('OutboxPublisherService', () => {
  const queueUrl = 'http://elasticmq:9324/000000000000/payment-result.fifo';
  const query = jest.fn();
  const send = jest.fn();
  let publisher: OutboxPublisherService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYMENT_RESULT_QUEUE_URL = queueUrl;
    const dataSource = {
      transaction: (work: (m: { query: typeof query }) => Promise<unknown>) =>
        work({ query }),
    } as unknown as DataSource;
    publisher = new OutboxPublisherService(dataSource, { send } as never);
  });

  afterAll(() => {
    delete process.env.PAYMENT_RESULT_QUEUE_URL;
  });

  const row = (eventId: string, reservationId: number) => ({
    event_id: eventId,
    reservation_id: reservationId,
    payload: JSON.stringify({ eventId, reservationId }),
  });

  it('미발행 행을 FIFO 그룹=예약 ID, 중복 제거 ID=event_id로 보내고 published_at을 기록한다', async () => {
    query
      .mockResolvedValueOnce([row('e1', 1), row('e2', 2)]) // SELECT ... FOR UPDATE SKIP LOCKED
      .mockResolvedValue({}); // UPDATE published_at
    send.mockResolvedValue({});

    const fetched = await publisher.publishBatch();

    expect(fetched).toBe(2);
    const [selectSql] = query.mock.calls[0] as [string];
    expect(selectSql).toContain('FOR UPDATE SKIP LOCKED');
    const sent = send.mock.calls.map(
      ([command]) => (command as SendMessageCommand).input,
    );
    expect(sent).toEqual([
      expect.objectContaining({
        QueueUrl: queueUrl,
        MessageGroupId: '1',
        MessageDeduplicationId: 'e1',
      }),
      expect.objectContaining({
        MessageGroupId: '2',
        MessageDeduplicationId: 'e2',
      }),
    ]);
    expect(query).toHaveBeenCalledWith(
      'UPDATE payment_outbox SET published_at = NOW(6) WHERE event_id = ?',
      ['e1'],
    );
    expect(query).toHaveBeenCalledWith(
      'UPDATE payment_outbox SET published_at = NOW(6) WHERE event_id = ?',
      ['e2'],
    );
  });

  it('보내기에 실패하면 그 행부터는 published_at을 기록하지 않고 멈춘다 (다음 주기에 재발행)', async () => {
    query
      .mockResolvedValueOnce([row('e1', 1), row('e2', 1)])
      .mockResolvedValue({});
    send.mockRejectedValueOnce(new Error('queue down'));

    await publisher.publishBatch();

    expect(send).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1); // SELECT만, UPDATE 없음
  });

  it('보낼 행이 없으면 아무것도 보내지 않는다', async () => {
    query.mockResolvedValueOnce([]);

    expect(await publisher.publishBatch()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
