import { SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { DataSource } from 'typeorm';
import { OutboxPublisherService } from './outbox-publisher.service';

describe('OutboxPublisherService', () => {
  const queueUrl = 'http://elasticmq:9324/000000000000/payment-result.fifo';
  // 가져가기(트랜잭션 안)·기록(트랜잭션 밖) 모두 이 query로 확인한다
  const query = jest.fn();
  const inTransaction: boolean[] = [];
  const send = jest.fn();
  let publisher: OutboxPublisherService;

  beforeEach(() => {
    jest.clearAllMocks();
    inTransaction.length = 0;
    process.env.PAYMENT_RESULT_QUEUE_URL = queueUrl;
    const dataSource = {
      transaction: (
        work: (m: { query: (...args: unknown[]) => unknown }) => unknown,
      ) =>
        work({
          query: (...args: unknown[]) => {
            inTransaction.push(true);
            return query(...args) as unknown;
          },
        }),
      query: (...args: unknown[]) => {
        inTransaction.push(false);
        return query(...args) as unknown;
      },
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
  const sqlCalls = () => query.mock.calls.map(([sql]) => String(sql));

  it('미발행 행을 맡아(lease) 커밋한 뒤, 트랜잭션 밖에서 한 번에 보내고 published_at을 기록한다', async () => {
    query
      .mockResolvedValueOnce([row('e1', 1), row('e2', 2)]) // SELECT ... FOR UPDATE SKIP LOCKED
      .mockResolvedValue({}); // UPDATE locked_until / published_at
    send.mockResolvedValue({ Successful: [{ Id: 'e1' }, { Id: 'e2' }] });

    const fetched = await publisher.publishBatch();

    expect(fetched).toBe(2);
    const [selectSql, claimSql, publishedSql] = sqlCalls();
    expect(selectSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimSql).toContain('SET locked_until');
    expect(publishedSql).toContain('SET published_at = NOW(6)');
    // 행 잠금은 가져가기 트랜잭션 안에서만 — 큐로 보낸 뒤의 기록은 트랜잭션 밖
    expect(inTransaction).toEqual([true, true, false]);
    expect(query).toHaveBeenNthCalledWith(3, expect.any(String), [
      ['e1', 'e2'],
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    const [[command]] = send.mock.calls as [SendMessageBatchCommand][];
    const { input } = command;
    expect(input.QueueUrl).toBe(queueUrl);
    expect(input.Entries).toEqual([
      expect.objectContaining({
        Id: 'e1',
        MessageGroupId: '1',
        MessageDeduplicationId: 'e1',
      }),
      expect.objectContaining({
        Id: 'e2',
        MessageGroupId: '2',
        MessageDeduplicationId: 'e2',
      }),
    ]);
  });

  it('같은 예약에 앞선 미발행 이벤트가 있는 행은 가져가지 않는다 (예약별 순서, 여러 대여도)', async () => {
    query.mockResolvedValueOnce([]);

    await publisher.publishBatch();

    const [selectSql] = sqlCalls();
    expect(selectSql).toContain('NOT EXISTS');
    expect(selectSql).toContain('prev.reservation_id = o.reservation_id');
    expect(selectSql).toContain(
      'locked_until IS NULL OR o.locked_until < NOW(6)',
    );
  });

  it('일부만 실패하면 성공한 행만 published_at을 기록하고, 실패한 행은 잠시 뒤 다시 가져가게 lease를 줄인다', async () => {
    query
      .mockResolvedValueOnce([row('e1', 1), row('e2', 2)])
      .mockResolvedValue({});
    jest
      .spyOn(publisher['logger'], 'error')
      .mockImplementation(() => undefined);
    send.mockResolvedValue({
      Successful: [{ Id: 'e1' }],
      Failed: [{ Id: 'e2', Code: 'InternalError', SenderFault: false }],
    });

    await publisher.publishBatch();

    const calls = query.mock.calls as [string, unknown[]][];
    const published = calls.find(([sql]) =>
      sql.includes('published_at = NOW(6)'),
    );
    const released = calls.find(
      ([sql]) =>
        sql.includes('locked_until') &&
        sql.includes('published_at IS NULL') &&
        !sql.includes('SELECT'),
    );
    expect(published?.[1]).toEqual([['e1']]);
    expect(released?.[1]).toEqual([['e2']]);
  });

  it('요청 자체가 실패하면(기한 초과 등) 맡은 행을 모두 풀고 오류를 던진다 (다음 주기에 재발행)', async () => {
    query.mockResolvedValueOnce([row('e1', 1)]).mockResolvedValue({});
    send.mockRejectedValueOnce(new Error('queue timeout'));

    await expect(publisher.publishBatch()).rejects.toThrow('queue timeout');

    const sqls = sqlCalls();
    expect(sqls.some((sql) => sql.includes('published_at = NOW(6)'))).toBe(
      false,
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('published_at IS NULL'),
      [['e1']],
    );
  });

  it('보낼 행이 없으면 아무것도 보내지 않는다', async () => {
    query.mockResolvedValueOnce([]);

    expect(await publisher.publishBatch()).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
