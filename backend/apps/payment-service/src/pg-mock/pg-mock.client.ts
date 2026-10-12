import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { RpcException } from '@nestjs/microservices';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';

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
const DEFAULT_BASE_URL = 'http://localhost:3007';

// PG(mock) 서버를 호출하는 유일한 진입점입니다. 실제 PG로 교체할 때는 이 클라이언트의
// 구현만 바꾸면 되고, payment-service.service.ts의 나머지 로직은 그대로 유지됩니다.
// n8n.client.ts(chat-bot-service)와 동일한 "외부 의존성 하나당 client 하나" 패턴입니다.
@Injectable()
export class PgMockClient {
  private readonly logger = new Logger(PgMockClient.name);

  constructor(private readonly httpService: HttpService) {}

  // 실제 PG의 "결제창 생성 → 결제 승인(confirm)" 두 단계를 동기로 이어서 호출합니다.
  // (동기로 처리하는 이유는 payment-service.service.ts의 requestPayment 주석 참고)
  async createAndApprove(params: {
    orderId: string;
    amount: number;
    orderName: string;
    paymentMethod: string;
  }): Promise<PgMockPaymentResult> {
    const baseUrl = process.env.PG_MOCK_SERVICE_URL || DEFAULT_BASE_URL;

    const created = await this.post<PgMockPaymentResult>(
      `${baseUrl}/payments`,
      params,
    ).catch((error: unknown) => {
      this.logError('PG 결제 요청 생성 실패', error);
      throw new RpcException('PG 결제 요청 생성에 실패했습니다.');
    });

    return this.post<PgMockPaymentResult>(
      `${baseUrl}/payments/${created.paymentKey}/approve`,
    ).catch((error: unknown) => {
      this.logError('PG 결제 승인 실패', error);
      throw new RpcException('결제 승인에 실패했습니다.');
    });
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
      throw new RpcException('PG 결제 취소에 실패했습니다.');
    });
  }

  private async post<T>(url: string, data?: unknown): Promise<T> {
    const { data: body } = await firstValueFrom(
      this.httpService.post<T>(url, data, { timeout: DEFAULT_TIMEOUT_MS }),
    );
    return body;
  }

  private logError(prefix: string, error: unknown) {
    const err = error as AxiosError;
    this.logger.error(`${prefix}: ${err.message}`, err.stack);
  }
}
