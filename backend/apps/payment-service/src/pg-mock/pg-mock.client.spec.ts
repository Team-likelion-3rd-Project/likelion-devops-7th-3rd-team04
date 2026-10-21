import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { PgMockClient } from './pg-mock.client';

// LDP-91: 가짜 결제 서버도 토스와 같은 조회 결과 형태 / 결과 불명이면 결제 번호를 남긴다
describe('PgMockClient', () => {
  const post = jest.fn();
  const get = jest.fn();
  let client: PgMockClient;

  const ok = <T>(data: T) => of({ data } as AxiosResponse<T>);
  const fail = (status?: number) =>
    throwError(() => {
      const error = new AxiosError(status ? `status ${status}` : 'timeout');
      if (status) {
        error.response = {
          status,
          data: { message: 'not found' },
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
        };
      }
      return error;
    });
  const record = (status: string) => ({
    paymentKey: 'pgmock_1',
    orderId: 'rsv1-abc',
    amount: 50000,
    orderName: '호텔 예약 #1',
    paymentMethod: 'CARD',
    status,
    createdAt: '2026-10-21T00:00:00Z',
    approvalNumber: '123',
    approvedAt: '2026-10-21T00:00:01Z',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    client = new PgMockClient({ post, get } as unknown as HttpService);
  });

  it('승인 단계 응답을 못 받으면 결과 불명 — 생성 단계에서 받은 결제 번호를 남긴다', async () => {
    post.mockReturnValueOnce(ok(record('READY'))).mockReturnValueOnce(fail());

    expect(
      await client.confirm({
        orderId: 'rsv1-abc',
        amount: 50000,
        orderName: 'x',
      }),
    ).toMatchObject({ outcome: 'UNKNOWN', paymentKey: 'pgmock_1' });
  });

  it.each([
    ['DONE', 'APPROVED'],
    ['CANCELED', 'CANCELED'],
    ['READY', 'PENDING'],
  ])('조회: pg-mock 상태 %s → %s', async (status, outcome) => {
    get.mockReturnValue(ok(record(status)));

    expect(await client.getPayment('pgmock_1')).toMatchObject({
      outcome,
      pgStatus: status,
      paymentKey: 'pgmock_1',
    });
  });

  it('조회: 승인 완료면 승인 번호·결제 수단도 담는다', async () => {
    get.mockReturnValue(ok(record('DONE')));

    expect(await client.getPayment('pgmock_1')).toMatchObject({
      approvalNumber: '123',
      method: 'CARD',
    });
  });

  it('조회: 없는 결제(재기동으로 사라짐 등) → NOT_FOUND, 조회 실패 → UNKNOWN', async () => {
    get.mockReturnValueOnce(fail(404)).mockReturnValueOnce(fail());

    expect((await client.getPayment('x')).outcome).toBe('NOT_FOUND');
    expect((await client.getPayment('x')).outcome).toBe('UNKNOWN');
  });
});
