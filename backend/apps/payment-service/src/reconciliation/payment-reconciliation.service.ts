import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, SelectQueryBuilder } from 'typeorm';
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
// 결과 불명 결제를 이만큼 지나도 확정하지 못하면 자동 조회를 멈추고 수동 확인(UNKNOWN_MANUAL_REQUIRED)으로 옮긴다.
// 토스는 승인되지 않은 결제를 이보다 훨씬 빨리 만료(EXPIRED)시키므로, 여기까지 오는 건 조회 자체가 계속 실패한 경우다.
const SETTLE_GIVE_UP_HOURS = 24;
// 환불 실패 재시도 간격 (첫 재시도)
const REFUND_RETRY_AFTER_SECONDS = 120;
// REFUND_REQUESTED가 이만큼 그대로면 환불 도중 서버가 죽은 것으로 보고 다시 시도한다 (PG 취소는 10초 안에 끝남)
const REFUND_STUCK_AFTER_SECONDS = 600;
// 환불을 이만큼 시도해도 실패하면 자동 재시도를 멈추고 수동 처리(REFUND_MANUAL_REQUIRED)로 옮긴다
const MAX_REFUND_ATTEMPTS = 10;
// 확정·환불하지 못한 건을 다시 볼 간격: 2분부터 두 배씩 늘려 최대 1시간 (2·4·8·16·32·60·60…분).
// 토스 장애가 길어져도 환불 10번을 30분 안에 다 써 버리지 않고(약 5시간에 걸쳐 시도), 확정 안 되는 건을 매번 조회하지 않는다.
const BACKOFF_BASE_SECONDS = 120;
const BACKOFF_MAX_SECONDS = 3600;
// PG를 동시에 부르는 수 — 쌓인 건을 빨리 처리하되 PG 호출 한도를 넘지 않게
const PG_CONCURRENCY = 4;
// PG 호출이 이만큼 연달아 실패하면 PG 장애로 보고 이번 실행을 멈춘다 (나머지는 다음 실행에서)
const MAX_CONSECUTIVE_PG_FAILURES = 5;
// 실행 한 번의 상한 — 넘으면 새 건은 시작하지 않는다 (진행 중인 호출은 마저 끝냄, PG 타임아웃 10초)
const MAX_RUN_MS = 45_000;
// 여러 대가 떠 있어도 한 대만 배치를 돌리게 하는 DB 잠금 이름 (MariaDB GET_LOCK)
const LOCK_NAME = 'payment:reconciliation';

export interface ReconciliationResult {
  approved: number; // 조회해 보니 승인 완료 → APPROVED 확정
  failed: number; // 실패로 끝남·PG에 없음·취소됨 → FAILED 확정
  pending: number; // 아직 진행 중·조회 실패 → 간격을 늘려 다음에 다시
  noPaymentKey: number; // 결제 번호가 없어 조회할 수 없음 → 기한까지 기다렸다 수동 확인
  settleGaveUp: number; // 기한 안에 확정 못 함 → UNKNOWN_MANUAL_REQUIRED로 옮김 (수동 확인)
  refunded: number; // 환불 재시도 성공
  refundFailed: number; // 환불 재시도 실패 (간격을 늘려 다음에 다시)
  refundGaveUp: number; // 최대 횟수 초과·환불 키 없음 → REFUND_MANUAL_REQUIRED로 옮김 (수동 처리)
  errors: number; // 한 건 처리 중 예외 (다음 실행에서 다시)
  stopped?: 'PG_FAILURES' | 'TIME_LIMIT'; // 이번 실행을 중간에 멈춘 이유
  skipped: boolean; // 다른 인스턴스가 실행 중이라 건너뜀
}

// 실행 한 번의 진행 상황 — 연속 PG 실패·실행 시간으로 중간에 멈출지 정한다 (LDP-97 A1)
class RunGuard {
  private consecutivePgFailures = 0;
  private readonly deadline: number;

  constructor(
    private readonly result: ReconciliationResult,
    now: number = Date.now(),
  ) {
    this.deadline = now + MAX_RUN_MS;
  }

  shouldStop(): boolean {
    if (!this.result.stopped && Date.now() > this.deadline) {
      this.result.stopped = 'TIME_LIMIT';
    }
    return Boolean(this.result.stopped);
  }

  // PG가 응답했으면 ok=true (승인·실패·진행 중 모두), 조회 실패·환불 실패면 false
  recordPg(ok: boolean) {
    if (ok) {
      this.consecutivePgFailures = 0;
      return;
    }
    this.consecutivePgFailures++;
    if (
      this.consecutivePgFailures >= MAX_CONSECUTIVE_PG_FAILURES &&
      !this.result.stopped
    ) {
      this.result.stopped = 'PG_FAILURES';
    }
  }
}

// n번째 재시도까지 기다릴 시간(초)
export function backoffSeconds(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(BACKOFF_BASE_SECONDS * 2 ** exponent, BACKOFF_MAX_SECONDS);
}

// 결제 대사 배치 (LDP-97, ERD "결제 흐름" — UNKNOWN 확정·환불 재시도).
//  ① 결과를 모르는 결제(UNKNOWN, 오래된 PROCESSING)를 PG에 결제 번호로 조회해 승인·실패로 확정하고,
//     결과 이벤트(Outbox → SQS)로 예약에 알린다. 승인이 늦게 확정돼 예약이 이미 만료됐으면 예약 쪽이 자동 환불한다(LDP-92).
//     확정하지 못하면 간격을 늘려 다시 조회하고, SETTLE_GIVE_UP_HOURS가 지나면 UNKNOWN_MANUAL_REQUIRED로 옮긴다.
//  ② 환불 실패(REFUND_FAILED)와 오래 멈춘 환불(REFUND_REQUESTED)을 처음 정한 환불 키 그대로 다시 요청한다.
//     MAX_REFUND_ATTEMPTS번 실패하면 REFUND_MANUAL_REQUIRED로 옮겨 자동 재시도를 멈추고 알람·이벤트 — 운영자가 PG 콘솔에서 처리한다.
//  - 1분마다 (RECONCILIATION_INTERVAL_SECONDS, 0이면 끔). (status, updatedAt)·(status, next_reconcile_at) Index로 대상을 찾는다.
//    시간 비교는 DB 시계(NOW)로 해서 서버 시간대와 상관없다.
//  - PG는 PG_CONCURRENCY개까지 동시에 부르고, 연속 실패·실행 시간 상한에 닿으면 이번 실행을 멈춘다(토스 장애 때 실행이 길어지지 않게).
//  - 여러 대가 떠 있으면 GET_LOCK을 잡은 한 대만 돈다. 상태 변경은 모두 조건부라 겹쳐도 한 번만 반영된다.
//  - 확정·환불하지 못한 건은 next_reconcile_at을 미뤄 그때까지 조회 대상에서 빠진다 — 한 건이 계속 앞을 막지 않게.
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
        r.settleGaveUp ||
        r.refunded ||
        r.refundFailed ||
        r.refundGaveUp ||
        r.errors ||
        r.stopped
      ) {
        this.logger.log(
          `결제 대사: 승인 확정 ${r.approved} · 실패 확정 ${r.failed} · 보류 ${r.pending} · 번호 없음 ${r.noPaymentKey} · 확인 중단 ${r.settleGaveUp} / 환불 재시도 성공 ${r.refunded} · 실패 ${r.refundFailed} · 중단 ${r.refundGaveUp} / 오류 ${r.errors}`,
        );
      }
      if (r.stopped) {
        this.logger.warn(
          r.stopped === 'PG_FAILURES'
            ? `결제 대사: PG 호출이 ${MAX_CONSECUTIVE_PG_FAILURES}번 연달아 실패해 이번 실행을 멈춥니다 (PG 장애 의심) — 남은 건은 다음 실행에서`
            : `결제 대사: 실행 시간 상한(${MAX_RUN_MS / 1000}초)에 닿아 멈춥니다 — 남은 건은 다음 실행에서`,
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
      settleGaveUp: 0,
      refunded: 0,
      refundFailed: 0,
      refundGaveUp: 0,
      errors: 0,
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
        const guard = new RunGuard(result);
        await this.settleUnknownPayments(result, guard);
        await this.retryFailedRefunds(result, guard);
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
  private async settleUnknownPayments(
    result: ReconciliationResult,
    guard: RunGuard,
  ) {
    const statuses = [PaymentStatus.UNKNOWN, PaymentStatus.PROCESSING];

    // 기한이 지난 건은 PG를 부르지 않고 수동 확인으로 옮긴다
    for (const payment of await this.findOlderThan(
      statuses,
      SETTLE_GIVE_UP_HOURS,
    )) {
      if (
        await this.paymentService.markSettleManualRequired(
          payment,
          `${SETTLE_GIVE_UP_HOURS}시간 안에 확정하지 못함`,
        )
      ) {
        result.settleGaveUp++;
      }
    }

    const payments = await this.findDue(statuses, SETTLE_AFTER_SECONDS);
    await this.runLimited(payments, guard, result, async (payment) => {
      if (!payment.paymentKey) {
        // 승인 요청이 PG에 닿기 전에 멈췄을 수도, 닿았을 수도 있다 — 결제 번호 없이는 확정할 수 없다.
        // 알람은 처음 발견했을 때만 (다시 확인될 때마다 남기면 쌓인다). 기한이 지나면 수동 확인으로 옮겨진다.
        result.noPaymentKey++;
        if (!payment.rawResponse?.reconcile) {
          this.logger.error(
            `[알람] 결과 불명 결제에 PG 결제 번호가 없어 확정할 수 없습니다 — PG 콘솔에서 주문번호로 확인 (paymentId=${payment.paymentId}, orderId=${payment.pgOrderId})`,
          );
        }
        await this.scheduleNextLookup(payment, {
          outcome: 'UNKNOWN',
          pgCode: 'PAYMENT_KEY_MISSING',
        });
        return;
      }
      const lookup = await this.lookup(payment);
      // 조회 실패(응답 없음·5xx 등)만 PG 실패로 센다. 진행 중(PENDING)은 PG가 응답한 것
      guard.recordPg(lookup.outcome !== 'UNKNOWN');
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
        await this.scheduleNextLookup(payment, lookup);
      }
    });
  }

  // ② 환불 재시도
  private async retryFailedRefunds(
    result: ReconciliationResult,
    guard: RunGuard,
  ) {
    const payments = [
      ...(await this.findDue(
        [PaymentStatus.REFUND_FAILED],
        REFUND_RETRY_AFTER_SECONDS,
      )),
      // 멈춘 환불은 다음 조회 시각과 상관없이 마지막 변경 시각으로만 본다 (방금 다시 요청 중인 건을 겹쳐 부르지 않게)
      ...(await this.findStale(
        [PaymentStatus.REFUND_REQUESTED],
        REFUND_STUCK_AFTER_SECONDS,
      )),
    ];
    await this.runLimited(payments, guard, result, async (payment) => {
      // 더 시도할 수 없는 건은 REFUND_MANUAL_REQUIRED로 옮겨 조회 대상에서 뺀다. 그대로 두면 updatedAt이 안 바뀌어
      // 매번 맨 앞에 다시 조회되고, BATCH_SIZE만큼 쌓이면 새 환불 실패 건이 재시도되지 못한다.
      const gaveUpReason = this.refundGaveUpReason(payment);
      if (gaveUpReason) {
        if (
          await this.paymentService.markRefundManualRequired(
            payment,
            gaveUpReason,
          )
        ) {
          result.refundGaveUp++;
        }
        return;
      }
      const refunded = await this.paymentService.retryRefund(payment);
      // PG 거절과 장애를 여기서는 구분할 수 없어 둘 다 실패로 센다 — 서로 다른 결제가 연달아 거절되는 일은 드물다
      guard.recordPg(refunded);
      if (refunded) {
        result.refunded++;
        this.logger.log(
          `환불 재시도 성공 (paymentId=${payment.paymentId}, reservationId=${payment.reservationId})`,
        );
        return;
      }
      // 다음 재시도는 간격을 늘려서. 이번이 마지막 시도였으면 다음 차례에 수동 처리로 옮긴다
      result.refundFailed++;
      const attempts = (Number(payment.rawResponse?.refundAttempts) || 0) + 1;
      await this.scheduleNextRefund(payment, attempts);
    });
  }

  // 자동 재시도를 멈출 이유. 계속 시도할 건이면 null
  private refundGaveUpReason(payment: Payment): string | null {
    if (!payment.refundIdempotencyKey) {
      return '환불 키 없음';
    }
    const attempts = Number(payment.rawResponse?.refundAttempts);
    if (attempts >= MAX_REFUND_ATTEMPTS) {
      return `${MAX_REFUND_ATTEMPTS}번 시도해도 실패`;
    }
    return null;
  }

  // 대상을 PG_CONCURRENCY개씩 동시에 처리한다. 멈출 때가 되면 새 건은 시작하지 않는다.
  // 한 건에서 난 예외는 그 건만 건너뛴다 (다음 실행에서 다시).
  private async runLimited(
    payments: Payment[],
    guard: RunGuard,
    result: ReconciliationResult,
    work: (payment: Payment) => Promise<void>,
  ) {
    let next = 0;
    const worker = async () => {
      while (next < payments.length && !guard.shouldStop()) {
        const payment = payments[next++];
        try {
          await work(payment);
        } catch (error) {
          result.errors++;
          this.logger.error(
            `결제 대사 중 오류 — 다음 실행에서 다시 (paymentId=${payment.paymentId})`,
            error instanceof Error ? error.stack : String(error),
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PG_CONCURRENCY, payments.length) }, worker),
    );
  }

  private lookup(payment: Payment): Promise<PgLookupResult> {
    const paymentKey = payment.paymentKey as string;
    return payment.provider === PaymentProvider.TOSS
      ? this.tossPaymentsClient.getPayment(paymentKey)
      : this.pgMockClient.getPayment(paymentKey);
  }

  private stale(
    statuses: PaymentStatus[],
    seconds: number,
  ): SelectQueryBuilder<Payment> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.status IN (:...statuses)', { statuses })
      .andWhere('payment.updatedAt < NOW(6) - INTERVAL :seconds SECOND', {
        seconds,
      });
  }

  // 상태가 statuses 중 하나이고 마지막 변경이 seconds초보다 오래된 결제. 시간 비교는 DB 시계로.
  private findStale(
    statuses: PaymentStatus[],
    seconds: number,
  ): Promise<Payment[]> {
    return this.stale(statuses, seconds)
      .orderBy('payment.updatedAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }

  // findStale 중 다음 조회 시각이 됐거나(미뤄 둔 건) 아직 정하지 않은 결제
  private findDue(
    statuses: PaymentStatus[],
    seconds: number,
  ): Promise<Payment[]> {
    return this.stale(statuses, seconds)
      .andWhere(
        '(payment.nextReconcileAt IS NULL OR payment.nextReconcileAt <= NOW(6))',
      )
      .orderBy('payment.updatedAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }

  // 만든 지 hours시간이 지난 결제
  private findOlderThan(
    statuses: PaymentStatus[],
    hours: number,
  ): Promise<Payment[]> {
    return this.paymentRepository
      .createQueryBuilder('payment')
      .where('payment.status IN (:...statuses)', { statuses })
      .andWhere('payment.createdAt < NOW(6) - INTERVAL :hours HOUR', { hours })
      .orderBy('payment.createdAt', 'ASC')
      .take(BATCH_SIZE)
      .getMany();
  }

  // 확정하지 못한 건: 마지막 조회 결과를 남기고, 다음 조회를 간격을 늘려 미룬다
  private async scheduleNextLookup(payment: Payment, lookup: PgLookupResult) {
    const attempts = (payment.reconcileAttempts ?? 0) + 1;
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
        reconcileAttempts: attempts,
        nextReconcileAt: () =>
          `NOW(6) + INTERVAL ${backoffSeconds(attempts)} SECOND`,
      },
    );
  }

  // 환불 재시도 실패: 다음 재시도를 간격을 늘려 미룬다 (실패 결과는 환불 기록이 이미 남겼다)
  private async scheduleNextRefund(payment: Payment, attempts: number) {
    await this.paymentRepository.update(
      { paymentId: payment.paymentId, status: PaymentStatus.REFUND_FAILED },
      {
        nextReconcileAt: () =>
          `NOW(6) + INTERVAL ${backoffSeconds(attempts)} SECOND`,
      },
    );
  }
}
