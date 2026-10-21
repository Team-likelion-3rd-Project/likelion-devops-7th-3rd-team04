import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
} from '../entities/payment.entity';
import { PaymentServiceService } from '../payment-service.service';
import { TossPaymentsClient } from '../pg/toss-payments.client';
import { PgMockClient } from '../pg-mock/pg-mock.client';
import { PgLookupResult } from '../pg/pg-lookup-result';

const DEFAULT_INTERVAL_SECONDS = 60;
// 한 번에 처리할 최대 건수 (남으면 다음 실행에서)
const BATCH_SIZE = 50;
// 승인 결과를 기다릴 시간 — 승인 요청은 10초 안에 끝나므로, 이보다 오래 UNKNOWN·PROCESSING이면 조회로 확정한다
const SETTLE_AFTER_SECONDS = 120;
// 환불 실패 재시도 간격
const REFUND_RETRY_AFTER_SECONDS = 120;
// REFUND_REQUESTED가 이만큼 그대로면 환불 도중 서버가 죽은 것으로 보고 다시 시도한다 (PG 취소는 10초 안에 끝남)
const REFUND_STUCK_AFTER_SECONDS = 600;
// 환불을 이만큼 시도해도 실패하면 자동 재시도를 멈추고 수동 처리로 넘긴다
const MAX_REFUND_ATTEMPTS = 10;
// 여러 대가 떠 있어도 한 대만 배치를 돌리게 하는 DB 잠금 이름 (MariaDB GET_LOCK)
const LOCK_NAME = 'payment:reconciliation';

export interface ReconciliationResult {
  approved: number; // 조회해 보니 승인 완료 → APPROVED 확정
  failed: number; // 실패로 끝남·PG에 없음·취소됨 → FAILED 확정
  pending: number; // 아직 진행 중·조회 실패 → 다음에 다시
  noPaymentKey: number; // 결제 번호가 없어 조회할 수 없음 → 수동 확인
  refunded: number; // 환불 재시도 성공
  refundFailed: number; // 환불 재시도 실패 (다음에 다시)
  refundGaveUp: number; // 최대 횟수 초과로 자동 재시도 중단 → 수동 처리
  skipped: boolean; // 다른 인스턴스가 실행 중이라 건너뜀
}

// 결제 대사 배치 (LDP-97, ERD "결제 흐름" — UNKNOWN 확정·환불 재시도).
//  ① 결과를 모르는 결제(UNKNOWN, 오래된 PROCESSING)를 PG에 결제 번호로 조회해 승인·실패로 확정하고,
//     결과 이벤트(Outbox → SQS)로 예약에 알린다. 승인이 늦게 확정돼 예약이 이미 만료됐으면 예약 쪽이 자동 환불한다(LDP-92).
//  ② 환불 실패(REFUND_FAILED)와 오래 멈춘 환불(REFUND_REQUESTED)을 처음 정한 환불 키 그대로 다시 요청한다.
//     MAX_REFUND_ATTEMPTS번 실패하면 자동 재시도를 멈추고 알람 — 운영자가 PG 콘솔에서 확인한다.
//  - 1분마다 (RECONCILIATION_INTERVAL_SECONDS, 0이면 끔). (status, updatedAt) Index(결제 V2)로 대상을 찾는다.
//    시간 비교는 DB 시계(NOW)로 해서 서버 시간대와 상관없다.
//  - 여러 대가 떠 있으면 GET_LOCK을 잡은 한 대만 돈다. 상태 변경은 모두 조건부라 겹쳐도 한 번만 반영된다.
//  - 확정하지 못한 건은 raw_response.reconcile에 마지막 조회 결과를 남긴다(updatedAt이 바뀌어 다음 순서로 밀림).
@Injectable()
export class PaymentReconciliationService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PaymentReconciliationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly dataSource: DataSource,
    private readonly paymentService: PaymentServiceService,
    private readonly tossPaymentsClient: TossPaymentsClient,
    private readonly pgMockClient: PgMockClient,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(
      process.env.RECONCILIATION_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS,
    );
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.logger.warn(
        '결제 대사 배치가 꺼져 있습니다 (RECONCILIATION_INTERVAL_SECONDS).',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.logger.log(`결제 대사 배치 시작: ${seconds}초 간격`);
  }

  onApplicationShutdown() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  // 이전 실행이 아직 안 끝났으면 겹쳐 돌지 않는다
  private async tick() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const r = await this.reconcile();
      if (
        r.approved ||
        r.failed ||
        r.noPaymentKey ||
        r.refunded ||
        r.refundFailed ||
        r.refundGaveUp
      ) {
        this.logger.log(
          `결제 대사: 승인 확정 ${r.approved} · 실패 확정 ${r.failed} · 보류 ${r.pending} · 번호 없음 ${r.noPaymentKey} / 환불 재시도 성공 ${r.refunded} · 실패 ${r.refundFailed} · 중단 ${r.refundGaveUp}`,
        );
      }
    } catch (error) {
      this.logger.error(
        '결제 대사 배치 실패 — 다음 실행에서 다시 시도',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  async reconcile(): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      approved: 0,
      failed: 0,
      pending: 0,
      noPaymentKey: 0,
      refunded: 0,
      refundFailed: 0,
      refundGaveUp: 0,
      skipped: false,
    };
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [lock] = (await runner.query('SELECT GET_LOCK(?, 0) AS ok', [
        LOCK_NAME,
      ])) as { ok: number | string | null }[];
      if (Number(lock?.ok) !== 1) {
        return { ...result, skipped: true };
      }
      try {
        await this.settleUnknownPayments(result);
        await this.retryFailedRefunds(result);
        return result;
      } finally {
        await runner
          .query('SELECT RELEASE_LOCK(?)', [LOCK_NAME])
          .catch(() => undefined);
      }
    } finally {
      await runner.release();
    }
  }

  // ① 결과 불명 결제 확정
  private async settleUnknownPayments(result: ReconciliationResult) {
    const payments = await this.findStale(
      [PaymentStatus.UNKNOWN, PaymentStatus.PROCESSING],
      SETTLE_AFTER_SECONDS,
    );
    for (const payment of payments) {
      if (!payment.paymentKey) {
        // 승인 요청이 PG에 닿기 전에 멈췄을 수도, 닿았을 수도 있다 — 결제 번호 없이는 확정할 수 없다.
        // 알람은 처음 발견했을 때만 (2분마다 다시 확인되므로 매번 남기면 쌓인다)
        result.noPaymentKey++;
        if (!payment.rawResponse?.reconcile) {
          this.logger.error(
            `[알람] 결과 불명 결제에 PG 결제 번호가 없어 확정할 수 없습니다 — PG 콘솔에서 주문번호로 확인 (paymentId=${payment.paymentId}, orderId=${payment.pgOrderId})`,
          );
        }
        await this.touch(payment, {
          outcome: 'UNKNOWN',
          pgCode: 'PAYMENT_KEY_MISSING',
        });
        continue;
      }
      const lookup = await this.lookup(payment);
      const settled = await this.paymentService.settleFromPgLookup(
        payment,
        lookup,
      );
      if (settled === 'APPROVED') {
        result.approved++;
      } else if (settled === 'FAILED') {
        result.failed++;
      } else {
        result.pending++;
        await this.touch(payment, lookup);
      }
    }
  }

  // ② 환불 재시도
  private async retryFailedRefunds(result: ReconciliationResult) {
    const payments = [
      ...(await this.findStale(
        [PaymentStatus.REFUND_FAILED],
        REFUND_RETRY_AFTER_SECONDS,
      )),
      ...(await this.findStale(
        [PaymentStatus.REFUND_REQUESTED],
        REFUND_STUCK_AFTER_SECONDS,
      )),
    ];
    for (const payment of payments) {
      const attempts = Number(payment.rawResponse?.refundAttempts);
      if (attempts >= MAX_REFUND_ATTEMPTS) {
        result.refundGaveUp++;
        continue; // 최대 횟수에 닿을 때 이미 알람을 남겼다
      }
      const refunded = await this.paymentService.retryRefund(payment);
      if (refunded) {
        result.refunded++;
        this.logger.log(
          `환불 재시도 성공 (paymentId=${payment.paymentId}, reservationId=${payment.reservationId})`,
        );
        continue;
      }
      result.refundFailed++;
      if (
        (Number.isFinite(attempts) ? attempts : 0) + 1 >=
        MAX_REFUND_ATTEMPTS
      ) {
        this.logger.error(
          `[알람] 환불을 ${MAX_REFUND_ATTEMPTS}번 시도해도 실패 — 자동 재시도 중단, PG 콘솔에서 수동 환불 필요 (paymentId=${payment.paymentId}, reservationId=${payment.reservationId})`,
        );
      }
    }
  }

  private lookup(payment: Payment): Promise<PgLookupResult> {
    const paymentKey = payment.paymentKey as string;
    return payment.provider === PaymentProvider.TOSS
      ? this.tossPaymentsClient.getPayment(paymentKey)
      : this.pgMockClient.getPayment(paymentKey);
  }

  // 상태가 statuses 중 하나이고 마지막 변경이 seconds초보다 오래된 결제. 시간 비교는 DB 시계로.
  private findStale(
    statuses: PaymentStatus[],
    seconds: number,
  ): Promise<Payment[]> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.status IN (:...statuses)', { statuses })
      .andWhere('payment.updatedAt < NOW(6) - INTERVAL :seconds SECOND', {
        seconds,
      })
      .orderBy('payment.updatedAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }

  // 확정하지 못한 건: 마지막 조회 결과를 남긴다 (updatedAt이 바뀌어 다음 실행에서 뒤로 밀림 — 한 건이 계속 앞을 막지 않게)
  private async touch(payment: Payment, lookup: PgLookupResult) {
    await this.paymentRepository.update(
      { paymentId: payment.paymentId, status: payment.status },
      {
        rawResponse: {
          ...(payment.rawResponse ?? {}),
          reconcile: {
            outcome: lookup.outcome,
            pgStatus: lookup.pgStatus,
            pgCode: lookup.pgCode,
            checkedAt: new Date().toISOString(),
          },
        },
      },
    );
  }
}
