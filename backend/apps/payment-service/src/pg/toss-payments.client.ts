import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PgConfirmResult } from './pg-confirm-result';

const DEFAULT_BASE_URL = 'https://api.tosspayments.com';
// 토스 승인 API가 이 시간 안에 응답하지 않으면 UNKNOWN으로 두고 대사 배치가 조회로 확정합니다.
const CONFIRM_TIMEOUT_MS = 10_000;

// 토스 결제 승인 API 응답 중 우리가 쓰는 필드 (전체는 raw_response에 그대로 저장)
interface TossPaymentResponse {
  paymentKey: string;
  orderId: string;
  status: string; // 승인 완료면 'DONE'
  method?: string; // '카드', '간편결제' 등
  approvedAt?: string;
  card?: { approveNo?: string };
}

// 토스 에러 응답 형식: { code: 'REJECT_CARD_COMPANY', message: '...' }
interface TossErrorResponse {
  code?: string;
  message?: string;
}

// 토스페이먼츠 결제 승인 API 클라이언트 (PAYMENT_PROVIDER=TOSS일 때만 사용).
//   POST {TOSS_API_BASE_URL}/v1/payments/confirm
//   - 인증: Basic base64("{시크릿 키}:") — 결제위젯을 쓰므로 "결제위젯 연동 키"의 시크릿 키
//   - Idempotency-Key 헤더: 같은 키로 다시 요청하면 토스가 처음 결과를 돌려줌 (중복 승인 방지)
//   - 본문: 결제창 성공 URL로 받은 paymentKey, orderId, amount 그대로
//
// 시크릿 키는 TOSS_SECRET_KEY 환경변수로만 받습니다 (코드·저장소에 절대 넣지 않음).
@Injectable()
export class TossPaymentsClient {
  private readonly logger = new Logger(TossPaymentsClient.name);

  constructor(private readonly httpService: HttpService) {}

  async confirm(params: {
    paymentKey: string;
    orderId: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<PgConfirmResult> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      // 설정 누락은 승인 요청 자체가 안 나간 것이라 UNKNOWN이 아니라 거절로 돌려줍니다.
      this.logger.error(
        'TOSS_SECRET_KEY가 설정되지 않아 토스 승인을 요청할 수 없습니다.',
      );
      return {
        outcome: 'DECLINED',
        pgCode: 'TOSS_SECRET_KEY_MISSING',
        pgMessage: '결제 설정 오류입니다. 관리자에게 문의해 주세요.',
      };
    }
    const baseUrl = process.env.TOSS_API_BASE_URL || DEFAULT_BASE_URL;
    const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<TossPaymentResponse>(
          `${baseUrl}/v1/payments/confirm`,
          {
            paymentKey: params.paymentKey,
            orderId: params.orderId,
            amount: params.amount,
          },
          {
            timeout: CONFIRM_TIMEOUT_MS,
            headers: {
              Authorization: authorization,
              'Content-Type': 'application/json',
              'Idempotency-Key': params.idempotencyKey,
            },
          },
        ),
      );

      if (data.status !== 'DONE') {
        // 가상계좌 등 "입금 대기" 상태는 이 서비스에서 쓰지 않으므로 확정되지 않은 것으로 둡니다.
        this.logger.warn(
          `토스 승인 응답 상태가 DONE이 아닙니다: ${data.status} (orderId=${params.orderId})`,
        );
        return {
          outcome: 'UNKNOWN',
          raw: data as unknown as Record<string, unknown>,
        };
      }

      return {
        outcome: 'APPROVED',
        paymentKey: data.paymentKey,
        approvalNumber: data.card?.approveNo,
        approvedAt: data.approvedAt ? new Date(data.approvedAt) : new Date(),
        method: data.method,
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<TossErrorResponse>;
      const status = err.response?.status;
      const body = err.response?.data;

      // 4xx: 토스가 요청을 받고 거절한 것 (카드 거절, 금액 불일치 등) → 돈이 안 움직였음이 확실
      if (status && status >= 400 && status < 500) {
        this.logger.warn(
          `토스 승인 거절 (orderId=${params.orderId}, status=${status}, code=${body?.code}): ${body?.message}`,
        );
        return {
          outcome: 'DECLINED',
          pgCode: body?.code,
          pgMessage: body?.message,
          raw: (body ?? {}) as Record<string, unknown>,
        };
      }

      // 타임아웃·네트워크 오류·5xx: 토스 쪽에서 승인됐을 수도 있음 → UNKNOWN
      this.logger.error(
        `토스 승인 결과 불명 (orderId=${params.orderId}, status=${status ?? '응답 없음'}): ${err.message}`,
      );
      return {
        outcome: 'UNKNOWN',
        pgCode: body?.code,
        pgMessage: body?.message ?? err.message,
        raw: (body ?? {}) as Record<string, unknown>,
      };
    }
  }
}
