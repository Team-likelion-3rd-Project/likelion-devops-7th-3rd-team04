import { HttpService } from '@nestjs/axios';
import { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { TossPaymentsClient } from './toss-payments.client';

// LDP-91: 토스 승인·조회 응답을 우리 결과 형태로 바꾸는 규칙
describe('TossPaymentsClient', () => {
  const post = jest.fn();
  const get = jest.fn();
  let client: TossPaymentsClient;
  const originalKey = process.env.TOSS_SECRET_KEY;

  const ok = <T>(data: T) => of({ data } as AxiosResponse<T>);
  const fail = (status: number | undefined, data?: Record<string, unknown>) =>
    throwError(() => {
      const error = new AxiosError(
        status ? `Request failed with status code ${status}` : 'timeout',
      );
      if (status) {
        error.response = {
          status,
          data,
          statusText: '',
          headers: {},
          config: { headers: new AxiosHeaders() },
        };
      }
      return error;
    });
  const done = {
    paymentKey: 'tgen_1',
    orderId: 'rsv1-abc',
    status: 'DONE',
    method: '카드',
    approvedAt: '2026-10-21T10:00:00+09:00',
    card: { approveNo: '00012345' },
  };
  const confirm = () =>
    client.confirm({
      paymentKey: 'tgen_1',
      orderId: 'rsv1-abc',
      amount: 50000,
      idempotencyKey: 'key-1',
    });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TOSS_SECRET_KEY = 'test_gsk_unit_test';
    client = new TossPaymentsClient({ post, get } as unknown as HttpService);
  });

  afterAll(() => {
    process.env.TOSS_SECRET_KEY = originalKey;
  });

  describe('confirm (승인)', () => {
    it('DONE이면 승인 — 결제 번호·승인 번호·결제 수단을 담는다', async () => {
      post.mockReturnValue(ok(done));

      expect(await confirm()).toMatchObject({
        outcome: 'APPROVED',
        paymentKey: 'tgen_1',
        approvalNumber: '00012345',
        method: '카드',
      });
      // 시크릿 키는 Basic 인증("키:"), 멱등 키는 헤더로
      const [, , config] = post.mock.calls[0] as [
        string,
        unknown,
        { headers: Record<string, string> },
      ];
      expect(config.headers.Authorization).toBe(
        `Basic ${Buffer.from('test_gsk_unit_test:').toString('base64')}`,
      );
      expect(config.headers['Idempotency-Key']).toBe('key-1');
    });

    it('간편결제는 결제 수단을 "간편결제 · 토스페이"로, 카드 정보가 없으면 승인 번호는 비운다 (LDP-124)', async () => {
      post.mockReturnValue(
        ok({
          paymentKey: 'tgen_2',
          orderId: 'rsv2-abc',
          status: 'DONE',
          method: '간편결제',
          approvedAt: '2026-10-22T10:28:13+09:00',
          card: null,
          easyPay: { provider: '토스페이', amount: 180000, discountAmount: 0 },
        }),
      );

      const result = await confirm();

      expect(result).toMatchObject({
        outcome: 'APPROVED',
        method: '간편결제 · 토스페이',
      });
      expect(result.approvalNumber).toBeUndefined();
    });

    it('카드 거절 등 4xx는 거절 — 토스 메시지를 그대로', async () => {
      post.mockReturnValue(
        fail(400, { code: 'REJECT_CARD_COMPANY', message: '카드사 거절' }),
      );

      expect(await confirm()).toMatchObject({
        outcome: 'DECLINED',
        pgCode: 'REJECT_CARD_COMPANY',
        pgMessage: '카드사 거절',
      });
    });

    it('결제창 시간 만료(NOT_FOUND_PAYMENT_SESSION, 404)도 거절 — 돈이 안 움직였다', async () => {
      post.mockReturnValue(
        fail(404, { code: 'NOT_FOUND_PAYMENT_SESSION', message: '만료' }),
      );

      expect((await confirm()).outcome).toBe('DECLINED');
    });

    it('키 오류(401)는 거절이지만 손님에게는 "결제 설정 오류"로만 보인다', async () => {
      post.mockReturnValue(
        fail(401, {
          code: 'UNAUTHORIZED_KEY',
          message: '인증되지 않은 시크릿 키 혹은 클라이언트 키 입니다.',
        }),
      );

      const result = await confirm();

      expect(result.outcome).toBe('DECLINED');
      expect(result.pgMessage).toBe(
        '결제 설정 오류입니다. 관리자에게 문의해 주세요.',
      );
    });

    it('이미 처리된 결제(ALREADY_PROCESSED_PAYMENT)는 조회해서 승인 완료면 승인으로', async () => {
      post.mockReturnValue(
        fail(400, { code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리' }),
      );
      get.mockReturnValue(ok(done));

      expect(await confirm()).toMatchObject({
        outcome: 'APPROVED',
        paymentKey: 'tgen_1',
        approvalNumber: '00012345',
      });
      expect(get).toHaveBeenCalledWith(
        'https://api.tosspayments.com/v1/payments/tgen_1',
        expect.anything(),
      );
    });

    it('이미 처리된 결제인데 조회도 실패하면 결과 불명 — 결제 번호를 남긴다', async () => {
      post.mockReturnValue(
        fail(400, { code: 'ALREADY_PROCESSED_PAYMENT', message: '이미 처리' }),
      );
      get.mockReturnValue(fail(undefined));

      expect(await confirm()).toMatchObject({
        outcome: 'UNKNOWN',
        paymentKey: 'tgen_1',
      });
    });

    it('타임아웃·5xx는 결과 불명 — 결제 번호를 남긴다', async () => {
      post.mockReturnValue(
        fail(500, { code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' }),
      );

      expect(await confirm()).toMatchObject({
        outcome: 'UNKNOWN',
        paymentKey: 'tgen_1',
      });
    });
  });

  describe('getPayment (조회)', () => {
    it.each([
      ['DONE', 'APPROVED'],
      ['CANCELED', 'CANCELED'],
      ['PARTIAL_CANCELED', 'CANCELED'],
      ['ABORTED', 'FAILED'],
      ['EXPIRED', 'FAILED'],
      ['IN_PROGRESS', 'PENDING'],
      ['WAITING_FOR_DEPOSIT', 'PENDING'],
    ])('토스 상태 %s → %s', async (status, outcome) => {
      get.mockReturnValue(ok({ ...done, status }));

      expect(await client.getPayment('tgen_1')).toMatchObject({
        outcome,
        pgStatus: status,
      });
    });

    it('없는 결제(404 NOT_FOUND_PAYMENT) → NOT_FOUND', async () => {
      get.mockReturnValue(
        fail(404, { code: 'NOT_FOUND_PAYMENT', message: '존재하지 않는 결제' }),
      );

      expect((await client.getPayment('nope')).outcome).toBe('NOT_FOUND');
    });

    it('조회 자체가 실패(타임아웃)하면 UNKNOWN — 나중에 다시 조회', async () => {
      get.mockReturnValue(fail(undefined));

      expect((await client.getPayment('tgen_1')).outcome).toBe('UNKNOWN');
    });

    it('시크릿 키가 없으면 조회하지 않고 UNKNOWN', async () => {
      delete process.env.TOSS_SECRET_KEY;

      expect((await client.getPayment('tgen_1')).outcome).toBe('UNKNOWN');
      expect(get).not.toHaveBeenCalled();
    });
  });
});
