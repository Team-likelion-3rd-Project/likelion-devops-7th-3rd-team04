import { QueryFailedError, Repository } from 'typeorm';
import { PgWebhookInbox } from '../entities/pg-webhook-inbox.entity';
import { TossWebhookInboxService } from './toss-webhook-inbox.service';

describe('TossWebhookInboxService', () => {
  const insert = jest.fn();
  const service = new TossWebhookInboxService({
    insert,
  } as unknown as Repository<PgWebhookInbox>);

  const headers = { 'tosspayments-webhook-transmission-id': 't1' };
  const body = {
    eventType: 'PAYMENT_STATUS_CHANGED',
    data: { paymentKey: 'pay_1', status: 'DONE' },
  };

  const dbError = (code: string, message: string) =>
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error(message), { code }),
    );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('결제 상태 변경 웹훅을 paymentKey·status 기준 키로 저장한다', async () => {
    insert.mockResolvedValue({});

    await service.record({ headers, body });

    expect(insert).toHaveBeenCalledWith({
      pgEventKey: 'toss:pay_1:DONE',
      eventType: 'PAYMENT_STATUS_CHANGED',
      headers,
      body,
    });
  });

  it('재전송으로 transmission-id가 달라도 같은 키로 저장한다', async () => {
    insert.mockResolvedValue({});

    await service.record({ headers, body });
    await service.record({
      headers: { 'tosspayments-webhook-transmission-id': 't2' },
      body,
    });

    const keys = insert.mock.calls.map(
      ([row]: [{ pgEventKey: string }]) => row.pgEventKey,
    );
    expect(new Set(keys).size).toBe(1);
  });

  it('이미 저장된 웹훅이면 오류 없이 넘어간다', async () => {
    insert.mockRejectedValue(
      dbError('ER_DUP_ENTRY', "for key 'uk_pg_webhook_inbox_pg_event_key'"),
    );

    await expect(service.record({ headers, body })).resolves.toBeUndefined();
  });

  it('중복이 아닌 DB 오류는 그대로 던진다', async () => {
    const error = dbError('ER_LOCK_DEADLOCK', 'deadlock');
    insert.mockRejectedValue(error);

    await expect(service.record({ headers, body })).rejects.toBe(error);
  });

  it('처리 대상이 아닌 이벤트는 저장하지 않는다', async () => {
    await service.record({ body: { eventType: 'CANCEL_STATUS_CHANGED' } });

    expect(insert).not.toHaveBeenCalled();
  });

  it('paymentKey나 status가 없으면 실패로 돌려 메시지를 남긴다', async () => {
    await expect(
      service.record({
        body: { eventType: 'PAYMENT_STATUS_CHANGED', data: {} },
      }),
    ).rejects.toThrow();

    expect(insert).not.toHaveBeenCalled();
  });
});
