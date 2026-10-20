import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, Observable } from 'rxjs';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { apiRpcException, parseApiRpcError } from '@app/common';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import {
  BookingGrpcResponse,
  BookingServiceService,
  RoomUnitGrpcResponse,
} from './booking-service.service';

// libs/common/src/proto/hotel.proto의 HotelService / GetRoomUnitsByIds와 1:1 대응
interface HotelRoomUnitGrpcService {
  getRoomUnitsByIds(data: {
    roomUnitIds: number[];
  }): Observable<{ units?: RoomUnitGrpcResponse[] }>;
}

// proto의 UnitAssignment 메시지와 1:1 대응
export interface UnitAssignmentGrpcResponse {
  reservationId: number;
  roomId: number;
  roomUnitId: number; // 배정 전 0
  checkInDate: string;
  checkOutDate: string;
  status: string;
  userId: number;
}

// 호실을 차지하는 예약 상태. 취소·만료·결제 실패·이용 완료 예약은 배정이 남아 있어도 호실을 막지 않는다.
const ACTIVE_STATUSES = [
  ReservationStatus.PENDING_PAYMENT,
  ReservationStatus.RESERVED,
];

// 같은 호실 배정을 한 줄로 세우는 잠금을 기다리는 시간(초)
const ASSIGN_LOCK_TIMEOUT_SECONDS = 5;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// 예약 호실 배정 — LDP-89.
// 예약은 객실 종류의 재고만 잡고(자동 배정 없음), 실제 호실은 직원이 나중에 배정한다. 배정 정보는 예약의 속성이라
// 이 서비스(reservations.room_id)에 두고, 호실 자체(번호·상태)는 hotel-service에 물어 확인한다.
@Injectable()
export class RoomAssignmentService implements OnModuleInit {
  private hotelService!: HotelRoomUnitGrpcService;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly dataSource: DataSource,
    private readonly bookingService: BookingServiceService,
    @Inject('HOTEL_SERVICE') private readonly hotelClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.hotelService =
      this.hotelClient.getService<HotelRoomUnitGrpcService>('HotelService');
  }

  // 예약에 호실 배정·변경·해제 (roomUnitId 0 = 해제).
  //  - 예약이 결제 대기·예약 확정이어야 하고, 호실은 예약한 객실 종류의 ACTIVE 호실이어야 한다.
  //  - 같은 호실·겹치는 기간(체크인 < 상대 체크아웃 && 체크아웃 > 상대 체크인)에 다른 배정이 있으면 409.
  //  - 두 직원이 같은 호실을 동시에 배정해도 하나만 성공하도록, 호실별 DB 잠금(GET_LOCK)을 잡고 확인 → 저장한다.
  async assign(
    reservationId: number,
    roomUnitId: number,
  ): Promise<BookingGrpcResponse> {
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
    if (!ACTIVE_STATUSES.includes(reservation.status)) {
      throw this.invalidStatus();
    }

    if (!roomUnitId) {
      await this.updateAssignment(reservationId, null);
      return this.bookingService.getBookingById(reservationId);
    }

    const unit = await this.findUnit(roomUnitId);
    if (
      unit.roomId !== reservation.roomId ||
      (reservation.hotelId != null && unit.hotelId !== reservation.hotelId) ||
      unit.status !== 'ACTIVE'
    ) {
      throw apiRpcException({
        status: 409,
        code: 'ROOM_UNIT_NOT_ASSIGNABLE',
        message:
          unit.status !== 'ACTIVE'
            ? `${unit.roomNumber}호는 점검 중이라 배정할 수 없습니다.`
            : `${unit.roomNumber}호는 이 예약의 객실 종류가 아닙니다.`,
        retryable: false,
      });
    }

    const lockName = `room_unit:${roomUnitId}`;
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [lock] = (await runner.query('SELECT GET_LOCK(?, ?) AS ok', [
        lockName,
        ASSIGN_LOCK_TIMEOUT_SECONDS,
      ])) as { ok: number | string | null }[];
      if (Number(lock?.ok) !== 1) {
        throw apiRpcException({
          status: 409,
          code: 'ROOM_UNIT_BUSY',
          message:
            '다른 직원이 같은 호실을 배정하고 있습니다. 잠시 후 다시 시도해 주세요.',
          retryable: true,
        });
      }

      const conflict = await runner.manager
        .createQueryBuilder(Reservation, 'r')
        .where('r.roomUnitId = :roomUnitId', { roomUnitId })
        .andWhere('r.reservationId <> :reservationId', { reservationId })
        .andWhere('r.status IN (:...statuses)', { statuses: ACTIVE_STATUSES })
        .andWhere('r.checkInDate < :checkOut', {
          checkOut: reservation.checkOutDate,
        })
        .andWhere('r.checkOutDate > :checkIn', {
          checkIn: reservation.checkInDate,
        })
        .getOne();
      if (conflict) {
        throw apiRpcException({
          status: 409,
          code: 'ROOM_UNIT_ASSIGNMENT_CONFLICT',
          message: `${unit.roomNumber}호에는 겹치는 기간의 예약(#${conflict.reservationId}, ${conflict.checkInDate}~${conflict.checkOutDate})이 이미 배정돼 있습니다.`,
          retryable: false,
        });
      }

      await this.updateAssignment(reservationId, roomUnitId, runner.manager);
    } finally {
      await runner
        .query('SELECT RELEASE_LOCK(?)', [lockName])
        .catch(() => undefined);
      await runner.release();
    }

    return this.bookingService.getBookingById(reservationId);
  }

  // 기간·지점의 배정 현황용 예약 목록 (결제 대기·예약 확정만). 기간(시작~종료, 둘 다 포함)과 숙박 기간이 겹치는 예약.
  async listAssignments(data: {
    hotelId: number;
    startDate: string;
    endDate: string;
    roomId?: number;
  }): Promise<UnitAssignmentGrpcResponse[]> {
    const reservations = await this.reservationRepository.find({
      where: {
        hotelId: data.hotelId,
        status: In(ACTIVE_STATUSES),
        checkInDate: LessThanOrEqual(data.endDate),
        checkOutDate: MoreThan(data.startDate),
        ...(data.roomId ? { roomId: data.roomId } : {}),
      },
      order: { checkInDate: 'ASC', reservationId: 'ASC' },
    });
    return reservations.map((r) => ({
      reservationId: r.reservationId,
      roomId: r.roomId,
      roomUnitId: r.roomUnitId ?? 0,
      checkInDate: r.checkInDate,
      checkOutDate: r.checkOutDate,
      status: r.status,
      userId: r.userId,
    }));
  }

  // 호실의 미래 배정 수 (체크아웃이 오늘 이후인 결제 대기·예약 확정). 호실 점검 전 확인용.
  async countFutureAssignments(roomUnitId: number): Promise<number> {
    return this.reservationRepository.count({
      where: {
        roomUnitId,
        status: In(ACTIVE_STATUSES),
        checkOutDate: MoreThan(todayUtc()),
      },
    });
  }

  // 조건부 UPDATE: 확인한 뒤 그 사이 예약이 취소·만료되면 배정하지 않는다
  private async updateAssignment(
    reservationId: number,
    roomUnitId: number | null,
    manager = this.reservationRepository.manager,
  ): Promise<void> {
    const { affected } = await manager.update(
      Reservation,
      { reservationId, status: In(ACTIVE_STATUSES) },
      { roomUnitId },
    );
    if (!affected) {
      throw this.invalidStatus();
    }
  }

  private async findUnit(roomUnitId: number): Promise<RoomUnitGrpcResponse> {
    const { units } = await firstValueFrom(
      this.hotelService.getRoomUnitsByIds({ roomUnitIds: [roomUnitId] }),
    ).catch((error: unknown) => {
      const payload = parseApiRpcError(error);
      throw payload
        ? apiRpcException(payload)
        : apiRpcException({
            status: 503,
            code: 'HOTEL_SERVICE_UNAVAILABLE',
            message:
              '호실 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
            retryable: true,
          });
    });
    const unit = units?.[0];
    if (!unit) {
      throw apiRpcException({
        status: 404,
        code: 'ROOM_UNIT_NOT_FOUND',
        message: '존재하지 않는 호실입니다.',
        retryable: false,
      });
    }
    return unit;
  }

  private invalidStatus() {
    return apiRpcException({
      status: 409,
      code: 'INVALID_RESERVATION_STATUS',
      message: '결제 대기·예약 확정 상태의 예약만 호실을 배정할 수 있습니다.',
      retryable: false,
    });
  }
}
