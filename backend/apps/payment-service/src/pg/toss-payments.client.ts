import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import { PgConfirmResult } from './pg-confirm-result';
import { PgCancelResult } from './pg-cancel-result';
import { PgLookupOutcome, PgLookupResult } from './pg-lookup-result';

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

// 토스 결제 상태 → 조회 결과 (LDP-91). 목록에 없는 상태는 PENDING으로 두고 다시 조회하게 한다.
const TOSS_STATUS_OUTCOME: Record<string, PgLookupOutcome> = {
  DONE: 'APPROVED',
  CANCELED: 'CANCELED',
  PARTIAL_CANCELED: 'CANCELED',
  ABORTED: 'FAILED',
  EXPIRED: 'FAILED',
  READY: 'PENDING',
  IN_PROGRESS: 'PENDING',
  WAITING_FOR_DEPOSIT: 'PENDING',
};

// 이미 승인된 결제에 승인을 다시 요청했을 때 토스가 주는 코드 — 거절이 아니라 "이미 처리됨"이라 조회로 확인한다
const ALREADY_PROCESSED_PAYMENT = 'ALREADY_PROCESSED_PAYMENT';
const CONFIG_ERROR_MESSAGE = '결제 설정 오류입니다. 관리자에게 문의해 주세요.';

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
          paymentKey: params.paymentKey,
          raw: data as unknown as Record<string, unknown>,
        };
      }

      return this.approvedResult(data);
    } catch (error: unknown) {
      const err = error as AxiosError<TossErrorResponse>;
      const status = err.response?.status;
      const body = err.response?.data;

      // "이미 처리된 결제": 거절이 아니라 이미 승인됐을 수 있다 → 조회로 실제 상태를 확인 (LDP-91)
      if (body?.code === ALREADY_PROCESSED_PAYMENT) {
        const lookup = await this.getPayment(params.paymentKey);
        if (lookup.outcome === 'APPROVED') {
          this.logger.warn(
            `토스가 이미 처리된 결제라고 답해 조회해 보니 승인 완료 — 승인으로 반영 (orderId=${params.orderId})`,
          );
          return { ...lookup, outcome: 'APPROVED' };
        }
        // 승인이 아니면(조회 실패 포함) 확정하지 않고 대사 배치에 맡긴다
        return {
          outcome: 'UNKNOWN',
          paymentKey: params.paymentKey,
          pgCode: body.code,
          pgMessage: body.message,
          raw: { confirm: body, lookup: lookup.raw ?? {} },
        };
      }

      // 401·403: 시크릿 키가 틀리거나 권한이 없음 — 토스가 요청을 처리하지 않았으므로 돈은 안 움직였다.
      // 손님에게는 "설정 오류"로만 보이고, 원인은 서버 로그(알람)로 남긴다.
      if (status === 401 || status === 403) {
        this.logger.error(
          `[알람] 토스 인증 실패 — TOSS_SECRET_KEY를 확인하세요 (status=${status}, code=${body?.code})`,
        );
        return {
          outcome: 'DECLINED',
          pgCode: body?.code,
          pgMessage: CONFIG_ERROR_MESSAGE,
          raw: (body ?? {}) as Record<string, unknown>,
        };
      }

      // 그 밖의 4xx: 토스가 요청을 받고 거절한 것 (카드 거절, 금액 불일치, 결제창 시간 만료 등) → 돈이 안 움직였음이 확실
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
        paymentKey: params.paymentKey,
        pgCode: body?.code,
        pgMessage: body?.message ?? err.message,
        raw: (body ?? {}) as Record<string, unknown>,
      };
    }
  }

  // 토스 결제 조회 API (LDP-91) — 대사 배치(LDP-97)·"이미 처리된 결제" 확인용.
  //   GET {TOSS_API_BASE_URL}/v1/payments/{paymentKey}
  // 주문번호(orderId) 조회(/v1/payments/orders/{orderId})는 토스 문서용 테스트 키에서 막혀 있어(NOT_FOUND_MERCHANT)
  // 결제 번호로 조회한다. 조회는 결제를 바꾸지 않으므로 몇 번 불러도 안전하다.
  async getPayment(paymentKey: string): Promise<PgLookupResult> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      this.logger.error(
        'TOSS_SECRET_KEY가 설정되지 않아 토스 결제를 조회할 수 없습니다.',
      );
      return {
        outcome: 'UNKNOWN',
        pgCode: 'TOSS_SECRET_KEY_MISSING',
        pgMessage: CONFIG_ERROR_MESSAGE,
      };
    }
    const baseUrl = process.env.TOSS_API_BASE_URL || DEFAULT_BASE_URL;
    const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<TossPaymentResponse>(
          `${baseUrl}/v1/payments/${encodeURIComponent(paymentKey)}`,
          {
            timeout: CONFIRM_TIMEOUT_MS,
            headers: { Authorization: authorization },
          },
        ),
      );
      const outcome = TOSS_STATUS_OUTCOME[data.status] ?? 'PENDING';
      if (outcome === 'APPROVED') {
        return { ...this.approvedResult(data), outcome, pgStatus: data.status };
      }
      return {
        outcome,
        pgStatus: data.status,
        paymentKey: data.paymentKey,
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<TossErrorResponse>;
      const body = err.response?.data;
      if (err.response?.status === 404) {
        return {
          outcome: 'NOT_FOUND',
          pgCode: body?.code,
          pgMessage: body?.message,
          raw: (body ?? {}) as Record<string, unknown>,
        };
      }
      this.logger.error(
        `토스 결제 조회 실패 (paymentKey=${paymentKey}, status=${err.response?.status ?? '응답 없음'}, code=${body?.code}): ${body?.message ?? err.message}`,
      );
      return {
        outcome: 'UNKNOWN',
        pgCode: body?.code,
        pgMessage: body?.message ?? err.message,
        raw: (body ?? {}) as Record<string, unknown>,
      };
    }
  }

  // 승인 완료(DONE) 응답 → 승인 결과 (승인 API·조회 API 공통)
  private approvedResult(data: TossPaymentResponse): PgConfirmResult & {
    outcome: 'APPROVED';
  } {
    return {
      outcome: 'APPROVED',
      paymentKey: data.paymentKey,
      approvalNumber: data.card?.approveNo,
      approvedAt: data.approvedAt ? new Date(data.approvedAt) : new Date(),
      method: data.method,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  // 토스 결제 취소(환불) API (LDP-28, ERD "환불").
  //   POST {TOSS_API_BASE_URL}/v1/payments/{paymentKey}/cancel   본문: { cancelReason } (전액 취소)
  //   - Idempotency-Key 헤더에 환불 멱등 키(payments.refund_idempotency_key)를 실어, 같은 환불이
  //     재시도돼도 토스가 한 번만 취소합니다.
  //   - 이미 취소된 결제(ALREADY_CANCELED_PAYMENT)는 같은 환불의 재시도로 보고 성공으로 처리합니다.
  async cancel(params: {
    paymentKey: string;
    cancelReason: string;
    idempotencyKey: string;
  }): Promise<PgCancelResult> {
    const secretKey = process.env.TOSS_SECRET_KEY;
    if (!secretKey) {
      this.logger.error(
        'TOSS_SECRET_KEY가 설정되지 않아 토스 결제 취소를 요청할 수 없습니다.',
      );
      return {
        outcome: 'FAILED',
        pgCode: 'TOSS_SECRET_KEY_MISSING',
        pgMessage: '결제 설정 오류로 환불하지 못했습니다.',
      };
    }
    const baseUrl = process.env.TOSS_API_BASE_URL || DEFAULT_BASE_URL;
    const authorization = `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<TossPaymentResponse & { canceledAt?: string }>(
          `${baseUrl}/v1/payments/${encodeURIComponent(params.paymentKey)}/cancel`,
          { cancelReason: params.cancelReason },
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
      return {
        outcome: 'CANCELED',
        canceledAt: new Date(),
        raw: data as unknown as Record<string, unknown>,
      };
    } catch (error: unknown) {
      const err = error as AxiosError<TossErrorResponse>;
      const body = err.response?.data;
      if (body?.code === 'ALREADY_CANCELED_PAYMENT') {
        this.logger.warn(
          `이미 취소된 토스 결제입니다 — 환불 완료로 처리합니다 (paymentKey=${params.paymentKey})`,
        );
        return {
          outcome: 'CANCELED',
          canceledAt: new Date(),
          raw: body as Record<string, unknown>,
        };
      }
      this.logger.error(
        `토스 결제 취소 실패 (paymentKey=${params.paymentKey}, status=${err.response?.status ?? '응답 없음'}, code=${body?.code}): ${body?.message ?? err.message}`,
      );
      return {
        outcome: 'FAILED',
        pgCode: body?.code,
        pgMessage: body?.message ?? err.message,
        raw: (body ?? {}) as Record<string, unknown>,
      };
    }
  }
}
