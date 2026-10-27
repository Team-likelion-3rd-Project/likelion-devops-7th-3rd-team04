import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookingServiceService } from './booking-service.service';
import { errorTrace } from '@app/common';

const DEFAULT_INTERVAL_SECONDS = 10;
// 한 번에 확인할 최대 건수 (남으면 다음 실행에서)
const BATCH_SIZE = 20;

export interface RefundRequestRunResult {
  delivered: number; // 결제 서비스에 전달됨
  retry: number; // 전달 실패 → 간격을 늘려 다시
}

// 환불 요청 워커 (LDP-97).
// pending_refunds(환불 필요 대기열)에서 요청할 때가 된 건을 결제 서비스에 전달한다.
//  - 대기열에는 예약 취소·"예약이 끝난 뒤 승인 이벤트"가 예약 상태 변경과 같은 트랜잭션으로 남긴다.
//    결제 결과 수신기가 환불을 직접 부르면 결제 서버가 느릴 때 큐 처리가 밀리고, 호출이 실패하면 환불이 유실됐다.
//  - 10초마다 (REFUND_REQUEST_INTERVAL_SECONDS, 0이면 끔). (completed_at, next_attempt_at) Index로 찾는다.
//  - 한 건씩 맡아서(lease) 부르므로 여러 대가 떠 있어도 같은 건을 겹쳐 부르지 않는다 (BookingServiceService.deliverRefund).
@Injectable()
export class RefundRequestWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RefundRequestWorker.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly bookingService: BookingServiceService,
  ) {}

  onApplicationBootstrap() {
    const seconds = Number(
      process.env.REFUND_REQUEST_INTERVAL_SECONDS ?? DEFAULT_INTERVAL_SECONDS,
    );
    if (!Number.isFinite(seconds) || seconds <= 0) {
      this.logger.warn(
        '환불 요청 워커가 꺼져 있습니다 (REFUND_REQUEST_INTERVAL_SECONDS).',
      );
      return;
    }
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
    this.logger.log(`환불 요청 워커 시작: ${seconds}초 간격`);
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
      const result = await this.processDue();
      if (result.delivered || result.retry) {
        this.logger.log(
          `환불 요청 전달 ${result.delivered}건, 실패해 다시 시도 ${result.retry}건`,
        );
      }
    } catch (error) {
      this.logger.error(
        '환불 요청 워커 실패 — 다음 실행에서 다시 시도',
        errorTrace(error),
      );
    } finally {
      this.running = false;
    }
  }

  async processDue(): Promise<RefundRequestRunResult> {
    const rows: { reservation_id: number }[] = await this.dataSource.query(
      `SELECT reservation_id FROM pending_refunds
        WHERE completed_at IS NULL AND next_attempt_at <= NOW(6)
        ORDER BY next_attempt_at
        LIMIT ?`,
      [BATCH_SIZE],
    );

    const result: RefundRequestRunResult = { delivered: 0, retry: 0 };
    for (const row of rows) {
      const outcome = await this.bookingService.deliverRefund(
        Number(row.reservation_id),
      );
      if (outcome === 'DELIVERED') {
        result.delivered++;
      } else if (outcome === 'RETRY') {
        result.retry++;
      }
    }
    return result;
  }
}
