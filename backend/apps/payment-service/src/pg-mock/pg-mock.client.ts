import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PgConfirmResult } from '../pg/pg-confirm-result';
import { PgCancelResult } from '../pg/pg-cancel-result';
import { PgLookupOutcome, PgLookupResult } from '../pg/pg-lookup-result';
import { rpcError } from '@app/common';

export interface PgMockPaymentResult {
  paymentKey: string;
  orderId: string;
  amount: number;
  orderName: string;
  paymentMethod: string;
  status: string;
  createdAt: string;
  approvalNumber?: string;
  approvedAt?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// pg-mock 결제 상태 → 조회 결과 (토스 클라이언트와 같은 형태, LDP-91)
const MOCK_STATUS_OUTCOME: Record<string, PgLookupOutcome> = {
  DONE: 'APPROVED',
  CANCELED: 'CANCELED',
  READY: 'PENDING',
};
const DEFAULT_BASE_URL = 'http://localhost:3007';

// PG(mock) 서버를 호출하는 유일한 진입점입니다. 실제 PG로 교체할 때는 이 클라이언트의
// 구현만 바꾸면 되고, payment-service.service.ts의 나머지 로직은 그대로 유지됩니다.
// n8n.client.ts(chat-bot-service)와 동일한 "외부 의존성 하나당 client 하나" 패턴입니다.
@Injectable()
export class PgMockClient {
  private readonly logger = new Logger(PgMockClient.name);

  constructor(private readonly httpService: HttpService) {}

  // 새 결제 흐름(위키 API 명세 5.9)의 MOCK 모드 승인. 토스 승인 API와 같은 결과 형태(PgConfirmResult)로
  // 돌려줘서 payment-service가 PG 종류와 상관없이 같은 로직을 쓰게 합니다.
  // pg-mock은 결제창이 없어서 "결제 생성 → 승인"을 이어서 호출합니다 (프론트가 보낸 mock_ paymentKey는
  // pg-mock이 발급한 키가 아니므로 쓰지 않고, 승인 후 pg-mock이 발급한 키를 저장합니다).
  //   forceFail: 승인 거절 화면 확인용 — pg-mock의 X-Mock-Result: fail 헤더로 거절을 재현
  async confirm(params: {
    orderId: string;
    amount: number;
    orderName: string;
    forceFail?: boolean;
  }): Promise<PgConfirmResult> {
    const baseUrl = process.env.PG_MOCK_SERVICE_URL || DEFAULT_BASE_URL;

    let created: PgMockPaymentResult;
    try {
      created = await this.post<PgMockPaymentResult>(`${baseUrl}/payments`, {
        orderId: params.orderId,
        amount: params.amount,
        orderName: params.orderName,
        paymentMethod: 'CARD',
      });
    } catch (error: unknown) {
      // 결제 생성 단계 실패는 승인 요청이 나가기 전이라 돈이 안 움직였음이 확실 → 거절로 처리
      this.logError('PG(mock) 결제 생성 실패', error);
      return {
        outcome: 'DECLINED',
        pgCode: 'PG_MOCK_CREATE_FAILED',
        pgMessage:
          '결제 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      };
    }

    try {
      const approved = await this.post<PgMockPaymentResult>(
        `${baseUrl}/payments/${created.paymentKey}/approve`,
        undefined,
        params.forceFail ? { 'X-Mock-Result': 'fail' } : undefined,
      );
      return {
        outcome: 'APPROVED',
        paymentKey: approved.paymentKey,
        approvalNumber: approved.approvalNumber,
        approvedAt: approved.approvedAt
          ? new Date(approved.approvedAt)
          : new Date(),
        method: approved.paymentMethod,
        raw: approved as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<{ message?: string }>;
      const status = err.response?.status;
      if (status && status >= 400 && status < 500) {
        return {
          outcome: 'DECLINED',
          pgCode: 'PG_MOCK_DECLINED',
          pgMessage:
            err.response?.data?.message ?? '결제 승인이 거절되었습니다.',
          raw: err.response?.data ?? {},
        };
      }
      // 승인 요청 후 응답을 못 받음 → 승인됐는지 알 수 없음 (실제 PG의 타임아웃과 같은 상황).
      // 생성 단계에서 받은 결제 번호를 남겨 대사 배치가 조회할 수 있게 한다 (LDP-91)
      this.logError('PG(mock) 결제 승인 결과 불명', error);
      return {
        outcome: 'UNKNOWN',
        paymentKey: created.paymentKey,
        pgMessage: err.message,
      };
    }
  }

  // 결제 조회 (LDP-91) — 토스 조회 API와 같은 결과 형태. pg-mock은 메모리에만 기록해서 재기동하면 NOT_FOUND가 된다.
  async getPayment(paymentKey: string): Promise<PgLookupResult> {
    const baseUrl = process.env.PG_MOCK_SERVICE_URL || DEFAULT_BASE_URL;
    try {
      const { data } = await firstValueFrom(
        this.httpService.get<PgMockPaymentResult>(
          `${baseUrl}/payments/${encodeURIComponent(paymentKey)}`,
          { timeout: DEFAULT_TIMEOUT_MS },
        ),
      );
      const outcome = MOCK_STATUS_OUTCOME[data.status] ?? 'PENDING';
      return {
        outcome,
        pgStatus: data.status,
        paymentKey: data.paymentKey,
        ...(outcome === 'APPROVED'
          ? {
              approvalNumber: data.approvalNumber,
              approvedAt: data.approvedAt
                ? new Date(data.approvedAt)
                : new Date(),
              method: data.paymentMethod,
            }
          : {}),
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<{ message?: string }>;
      if (err.response?.status === 404) {
        return { outcome: 'NOT_FOUND', pgMessage: err.response.data?.message };
      }
      this.logError('PG(mock) 결제 조회 실패', error);
      return { outcome: 'UNKNOWN', pgMessage: err.message };
    }
  }

  // 환불(LDP-28)용 결제 취소. 토스 취소 API와 같은 결과 형태(PgCancelResult)로 돌려줍니다.
  // pg-mock은 이미 취소된 결제를 다시 취소하면 409(현재 상태: CANCELED)를 주는데, 같은 환불의 재시도이므로
  // 성공으로 처리합니다. 그 밖의 실패(재기동으로 결제 기록이 사라진 경우 등)는 FAILED.
  async refund(
    paymentKey: string,
    cancelReason: string,
  ): Promise<PgCancelResult> {
    const baseUrl = process.env.PG_MOCK_SERVICE_URL || DEFAULT_BASE_URL;
    try {
      const canceled = await this.post<
        PgMockPaymentResult & { canceledAt?: string }
      >(`${baseUrl}/payments/${paymentKey}/cancel`, { cancelReason });
      return {
        outcome: 'CANCELED',
        canceledAt: canceled.canceledAt
          ? new Date(canceled.canceledAt)
          : new Date(),
        raw: canceled as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<{ message?: string }>;
      const message = err.response?.data?.message ?? err.message;
      if (err.response?.status === 409 && message.includes('CANCELED')) {
        return {
          outcome: 'CANCELED',
          canceledAt: new Date(),
          pgMessage: message,
        };
      }
      this.logError('PG(mock) 결제 취소 실패', error);
      return {
        outcome: 'FAILED',
        pgCode: 'PG_MOCK_CANCEL_FAILED',
        pgMessage: message,
        raw: err.response?.data ?? {},
      };
    }
  }

  // PG 결제 취소(환불) 요청. 승인(approve)된 결제만 취소할 수 있다 — pg-mock 쪽에서 상태 검증.
  async cancel(
    paymentKey: string,
    params?: { cancelReason?: string },
  ): Promise<PgMockPaymentResult> {
    const baseUrl = process.env.PG_MOCK_SERVICE_URL || DEFAULT_BASE_URL;

    return this.post<PgMockPaymentResult>(
      `${baseUrl}/payments/${paymentKey}/cancel`,
      params,
    ).catch((error: unknown) => {
      this.logError('PG 결제 취소 실패', error);
      throw rpcError(GrpcStatus.UNAVAILABLE, 'PG 결제 취소에 실패했습니다.');
    });
  }

  private async post<T>(
    url: string,
    data?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const { data: body } = await firstValueFrom(
      this.httpService.post<T>(url, data, {
        timeout: DEFAULT_TIMEOUT_MS,
        headers,
      }),
    );
    return body;
  }

  private logError(prefix: string, error: unknown) {
    const err = error as AxiosError;
    this.logger.error(`${prefix}: ${err.message}`, err.stack);
  }
}
