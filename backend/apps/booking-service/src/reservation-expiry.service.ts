import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, LessThan, Repository } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { BookingServiceService } from './booking-service.service';
import { errorTrace } from '@app/common';

// 한 번에 확인할 최대 예약 수 (남으면 다음 실행에서 이어서)
const BATCH_SIZE = 100;
// 여러 대가 떠 있어도 한 대만 배치를 돌리게 하는 DB 잠금 이름 (MariaDB GET_LOCK)
const LOCK_NAME = 'booking:reservation-expiry';
const DEFAULT_INTERVAL_SECONDS = 60;

export interface ExpiryRunResult {
  expired: number; // EXPIRED로 바꾸고 재고를 돌려놓은 예약
  held: number; // 결제 확인 중(CONFIRMING)이라 이번에는 보류한 예약
  skipped: boolean; // 다른 인스턴스가 실행 중이라 건너뜀
}

// 결제 대기 예약 자동 만료 배치 (LDP-92).
// 결제 마감(payment_due_at)이 지난 결제 대기(PENDING_PAYMENT) 예약을 EXPIRED로 바꾸고 재고를 돌려놓는다.
//  - 1분마다 (RESERVATION_EXPIRY_INTERVAL_SECONDS로 조절, 0이면 끔). (status, payment_due_at) Index(V3)로 찾는다.
//  - 결제 확인 중(승인 요청 후 결과 대기, CONFIRMING)이면 이번에는 만료하지 않는다 — 돈이 빠졌을 수 있다.
//    확인 중 상태는 10분이 지나면 풀리므로 그 뒤 실행에서 만료된다. 그 뒤 승인 이벤트가 오면 자동 환불된다.
//  - 예약 한 건씩 행을 잠그고(결제 승인 직전 단계와 같은 잠금) 다시 확인한 뒤 조건부로 바꾼다 —
//    만료와 결제 승인 요청이 동시에 일어나도 둘 중 하나만 진행된다.
//  - 여러 대가 떠 있으면 GET_LOCK을 잡은 한 대만 돈다. 잠금이 없어도 조건부 UPDATE라 같은 예약이 두 번 만료되지 않는다.
//  - 연장 예약은 원래 예약이 예약 확정일 때만 만들 수 있어서, 결제 대기 상태로 만료되는 원래 예약에는 연장 예약이 없다.
@Injectable()
export class ReservationExpiryService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ReservationExpiryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly dataSource: DataSource,
    private readonly bookingService: BookingServiceService,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(
      process.env.RESERVATION_EXPIRY_INTERVAL_SECONDS ??
        DEFAULT_INTERVAL_SECONDS,
    );
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.logger.warn(
        '결제 대기 예약 만료 배치가 꺼져 있습니다 (RESERVATION_EXPIRY_INTERVAL_SECONDS).',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.logger.log(`결제 대기 예약 만료 배치 시작: ${seconds}초 간격`);
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
      const result = await this.expireOverdue();
      if (result.expired || result.held) {
        this.logger.log(
          `결제 마감 지난 예약 만료 ${result.expired}건, 결제 확인 중이라 보류 ${result.held}건`,
        );
      }
    } catch (error) {
      this.logger.error(
        '결제 대기 예약 만료 배치 실패 — 다음 실행에서 다시 시도',
        errorTrace(error),
      );
    } finally {
      this.running = false;
    }
  }

  async expireOverdue(now: Date = new Date()): Promise<ExpiryRunResult> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [lock] = (await runner.query('SELECT GET_LOCK(?, 0) AS ok', [
        LOCK_NAME,
      ])) as { ok: number | string | null }[];
      if (Number(lock?.ok) !== 1) {
        return { expired: 0, held: 0, skipped: true };
      }
      try {
        return await this.expireCandidates(now);
      } finally {
        await runner
          .query('SELECT RELEASE_LOCK(?)', [LOCK_NAME])
          .catch(() => undefined);
      }
    } finally {
      await runner.release();
    }
  }

  private async expireCandidates(now: Date): Promise<ExpiryRunResult> {
    const candidates = await this.reservationRepository.find({
      select: { reservationId: true },
      where: {
        status: ReservationStatus.PENDING_PAYMENT,
        paymentDueAt: LessThan(now),
      },
      order: { paymentDueAt: 'ASC' },
      take: BATCH_SIZE,
    });

    let expired = 0;
    let held = 0;
    for (const { reservationId } of candidates) {
      const outcome = await this.expireOne(reservationId, now);
      if (outcome === 'held') {
        held++;
      } else if (outcome) {
        expired++;
        await this.bookingService.releaseInventory(outcome, '결제 마감 만료');
      }
    }
    return { expired, held, skipped: false };
  }

  // 예약 한 건을 잠그고 다시 확인한 뒤 만료. 만료했으면 그 예약, 결제 확인 중이면 'held', 그 사이 바뀌었으면 null
  private expireOne(
    reservationId: number,
    now: Date,
  ): Promise<Reservation | 'held' | null> {
    return this.dataSource.transaction(async (manager) => {
      const reservation = await manager.findOne(Reservation, {
        where: {
          reservationId,
          status: ReservationStatus.PENDING_PAYMENT,
          paymentDueAt: LessThan(now),
        },
        lock: { mode: 'pessimistic_write' },
      });
      if (!reservation) {
        return null; // 그 사이 결제 완료·취소됨
      }
      if (
        await this.bookingService.findConfirmingAttempt(manager, reservationId)
      ) {
        return 'held';
      }
      await manager.update(
        Reservation,
        { reservationId, status: ReservationStatus.PENDING_PAYMENT },
        { status: ReservationStatus.EXPIRED },
      );
      reservation.status = ReservationStatus.EXPIRED;
      return reservation;
    });
  }
}
