import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { apiRpcException } from '@app/common';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import {
  BookingGrpcResponse,
  BookingServiceService,
  CancelRecord,
  PAYMENT_DUE_MINUTES,
} from './booking-service.service';
import { RoomAssignmentService } from './room-assignment.service';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const CANCEL_REASON_MAX_LENGTH = 255;

// 직원이 만든 예약(대리 예약·연장 예약)의 결제 마감: 생성한 날 밤 자정(한국 시간).
// 자정까지 30분이 안 남았으면 생성 + 30분 (회원이 결제할 최소 시간). — LDP-83 결정, LDP-90
export function adminPaymentDueAt(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const nextMidnight =
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() + 1) -
    KST_OFFSET_MS;
  const minimum = now.getTime() + PAYMENT_DUE_MINUTES * 60 * 1000;
  return new Date(Math.max(nextMidnight, minimum));
}

// 관리자 예약 기능 — 대리 예약·직원 취소·투숙 연장 (LDP-90).
// 예약은 회원만 할 수 있고, 직원이 만든 예약도 결제는 손님이 앱에서 한다(손님 앱 "결제 대기"에 보임).
// 생성·취소의 실제 처리(재고·금액·환불)는 손님 예약과 같은 코드(BookingServiceService)를 쓰고,
// 여기서는 직원 기록(만든·취소한 직원, 사유, 연결 예약)과 관리자용 검증만 더한다.
@Injectable()
export class AdminBookingService {
  private readonly logger = new Logger(AdminBookingService.name);

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly bookingService: BookingServiceService,
    private readonly roomAssignmentService: RoomAssignmentService,
  ) {}

  // 대리 예약 생성. 회원 존재 확인과 직원 이름 조회는 api-gateway가 하고 넘긴다.
  async createProxyBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
    adminId: number;
    adminName: string;
  }): Promise<BookingGrpcResponse> {
    const { adminId, adminName, ...booking } = data;
    return this.bookingService.createBooking(booking, {
      createdByAdminId: adminId,
      createdByAdminName: adminName,
      paymentDueAt: adminPaymentDueAt(),
    });
  }

  // 직원 취소. 결제 대기·예약 확정 예약 모두 취소할 수 있고, 손님 취소와 같은 경로로 재고 반환·전액 환불한다.
  // 원래 예약을 취소하면 연결된 연장 예약도 같은 사유로 함께 취소한다.
  async cancel(data: {
    reservationId: number;
    adminId: number;
    cancelReason: string;
  }): Promise<BookingGrpcResponse> {
    const cancelReason = (data.cancelReason ?? '').trim();
    if (!cancelReason || cancelReason.length > CANCEL_REASON_MAX_LENGTH) {
      throw apiRpcException({
        status: 400,
        code: 'INVALID_CANCEL_REASON',
        message: `취소 사유를 1~${CANCEL_REASON_MAX_LENGTH}자로 입력해 주세요.`,
        retryable: false,
      });
    }
    const reservation = await this.findReservation(data.reservationId);
    const record: CancelRecord = {
      cancelledByAdminId: data.adminId,
      cancelReason,
    };
    if (!(await this.bookingService.cancelReservation(reservation, record))) {
      throw this.invalidStatus(
        '결제 대기·예약 확정 상태의 예약만 취소할 수 있습니다.',
      );
    }
    if (!reservation.linkedReservationId) {
      await this.bookingService.cancelLinkedExtensions(
        reservation.reservationId,
        record,
      );
    }
    return this.bookingService.getBookingById(reservation.reservationId);
  }

  // 연장 예약 생성. 연장할 예약(예약 확정)의 체크아웃부터 새 예약을 이어 붙인다 — 같은 회원·객실 종류·인원.
  // 연장의 연장은 가장 최근 연장 예약 번호로 요청하고, 새 예약은 맨 처음 원래 예약에 연결한다
  // (원래 예약을 취소하면 연장분이 한 번에 함께 취소되도록).
  // keepSameRoomUnit이면 연장할 예약의 호실을 그대로 배정해 보고, 그 기간에 비어 있지 않으면 미배정으로 둔다.
  async createExtension(data: {
    reservationId: number;
    checkOutDate: string;
    keepSameRoomUnit: boolean;
    adminId: number;
    adminName: string;
  }): Promise<BookingGrpcResponse> {
    const base = await this.findReservation(data.reservationId);
    if (base.status !== ReservationStatus.RESERVED) {
      throw this.invalidStatus('예약 확정된 예약만 연장할 수 있습니다.');
    }
    if (!data.checkOutDate || data.checkOutDate <= base.checkOutDate) {
      throw apiRpcException({
        status: 400,
        code: 'INVALID_EXTENSION_DATES',
        message: `연장 체크아웃은 기존 체크아웃(${base.checkOutDate})보다 뒤여야 합니다.`,
        retryable: false,
      });
    }

    const extension = await this.bookingService.createBooking(
      {
        userId: base.userId,
        roomId: base.roomId,
        hotelId: base.hotelId as number,
        checkInDate: base.checkOutDate,
        checkOutDate: data.checkOutDate,
        guestCount: base.guestCount,
      },
      {
        createdByAdminId: data.adminId,
        createdByAdminName: data.adminName,
        paymentDueAt: adminPaymentDueAt(),
        linkedReservationId: base.linkedReservationId ?? base.reservationId,
      },
    );

    if (data.keepSameRoomUnit && base.roomUnitId) {
      try {
        return await this.roomAssignmentService.assign(
          extension.reservationId,
          base.roomUnitId,
        );
      } catch (error) {
        // 같은 호실이 그 기간에 다른 예약에 배정됐거나 점검 중 — 연장 예약은 그대로 두고 직원이 배정한다
        this.logger.warn(
          `연장 예약(#${extension.reservationId}) 같은 호실(${base.roomUnitId}) 배정 안 됨 — 미배정으로 둠: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return this.bookingService.getBookingById(extension.reservationId);
  }

  private async findReservation(reservationId: number): Promise<Reservation> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw apiRpcException({
        status: 404,
        code: 'RESERVATION_NOT_FOUND',
        message: '존재하지 않는 예약입니다.',
        retryable: false,
      });
    }
    return reservation;
  }

  private invalidStatus(message: string) {
    return apiRpcException({
      status: 409,
      code: 'INVALID_RESERVATION_STATUS',
      message,
      retryable: false,
    });
  }
}
