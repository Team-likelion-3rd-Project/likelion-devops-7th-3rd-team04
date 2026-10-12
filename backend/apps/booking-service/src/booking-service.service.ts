import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ClientGrpc, RpcException } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import { Repository } from 'typeorm';
import { Reservation, ReservationStatus } from './entities/reservation.entity';
import { ReservationFacilityService } from './reservation-facility.service';

// libs/common/src/proto/hotel.proto의 HotelService / SetRoomAvailability와 1:1 대응
interface HotelGrpcService {
  setRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
    isAvailable: boolean;
  }): Observable<{ success: boolean }>;
}
// libs/common/src/proto/hotel.proto의 ReserveRoomAvailabilityResponse 메시지와 1:1 대응
interface ReserveRoomAvailabilityGrpcResponse {
  totalAmount: number;
}

interface HotelGrpcService {
  reserveRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
  }): Observable<ReserveRoomAvailabilityGrpcResponse>;
}

// libs/common/src/proto/hotel.proto의 Facility 메시지와 1:1 대응
interface FacilityGrpcResponse {
  facilityId: number;
  hotelId: number;
  name: string;
  price: number;
}

// libs/common/src/proto/hotel.proto의 HotelService / GetFacilities와 1:1 대응
interface HotelGrpcService {
  getFacilities(data: {
    hotelId: number;
  }): Observable<{ facilities: FacilityGrpcResponse[] }>;
}

// libs/common/src/proto/payment.proto의 PaymentService / RefundPayment와 1:1 대응
interface PaymentGrpcService {
  refundPayment(data: {
    reservationId: number;
  }): Observable<{ refunded: boolean }>;
}

// 'YYYY-MM-DD' 문자열에 일 단위 offset을 더한 'YYYY-MM-DD' 문자열을 반환한다 (UTC 기준 계산,
// date 컬럼은 시간대 정보가 없으므로 로컬 타임존에 영향받지 않도록 UTC로 계산한다).
function addDays(dateStr: string, offset: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// 서버 기준 오늘 날짜를 'YYYY-MM-DD'로 반환한다 (UTC 기준 — addDays/dayBefore와 동일한 원칙).
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// 편의시설은 종류가 호텔마다 자유롭게 늘어날 수 있는 일반적인 카탈로그(hotel-service의 facilities
// 테이블)로 분리되어 있지만, 프론트/이 서비스는 아직 수영장·라운지 두 가지 고정 옵션만 지원한다.
// 호텔별 facilities 테이블에 아래 이름과 정확히 일치하는 row가 있어야 예약 시 해당 옵션을 선택할 수 있다.
const FACILITY_NAME_INDOOR_POOL = '수영장';
const FACILITY_NAME_LOUNGE = '라운지';

// proto의 Booking 메시지와 1:1 대응되는 응답 형태. 편의시설(수영장/라운지) 이용 여부/인원수는
// 여기 담지 않는다 — reservation_facilities가 유일한 소스이며, 필요하면
// getReservationFacilitiesByReservationId로 별도 조회한다.
export interface BookingGrpcResponse {
  reservationId: number;
  userId: number;
  roomId: number;
  hotelId?: number;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  totalAmount: number;
  status: string;
}

// 호텔 상세 페이지의 "호텔별 지표" 섹션이 사용하는 응답. hotelId 스냅샷 컬럼 덕분에
// hotel-service 호출 없이 이 서비스의 reservations 테이블만으로 계산된다. proto의
// HotelBookingStats 메시지와 1:1 대응.
export interface HotelBookingStatsGrpcResponse {
  checkInsToday: number;
  checkOutsToday: number;
  occupiedRoomsToday: number;
  newReservationsToday: number;
  cancellationsToday: number;
  revenueToday: number;
}

@Injectable()
export class BookingServiceService implements OnModuleInit {
  private readonly logger = new Logger(BookingServiceService.name);
  private hotelService!: HotelGrpcService;
  private paymentService!: PaymentGrpcService;

  constructor(
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
    private readonly reservationFacilityService: ReservationFacilityService,
    @Inject('HOTEL_SERVICE') private readonly hotelClient: ClientGrpc,
    @Inject('PAYMENT_SERVICE') private readonly paymentClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.hotelService =
      this.hotelClient.getService<HotelGrpcService>('HotelService');
    this.paymentService =
      this.paymentClient.getService<PaymentGrpcService>('PaymentService');
  }

  getHello(): string {
    return 'Booking Hello World!';
  }

  // 신규 예약 생성. checkInDate~(checkOutDate 하루 전)까지가 실제로 묵는 기간(박 수)이므로,
  // hotel-service의 ReserveRoomAvailability도 이 기간을 기준으로 검증/전환한다.
  // hotel-service가 이미 원자적으로 검증+전환을 수행하므로, 여기서는 그 결과(totalAmount)를 받아
  // 예약 row를 저장하기만 하면 된다.
  //
  // 편의시설(수영장/라운지) 요금은 hotel-service의 facilities 테이블에서 실제 단가(1인 1회 기준)를
  // 조회한 뒤 이용 인원수(poolGuestCount/loungeGuestCount)를 곱해 계산한다 — 예약 전체 인원수
  // (guestCount)와 무관하게 시설별로 실제 이용하는 인원만큼만 청구한다. 계산된 금액은
  // reservation_facilities에 시설별로 한 행씩 기록되어 나중에 예약 상세에서 조회할 수 있다
  // ([[facilities-reservation-facilities-design]] 메모리 참고).
  async createBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
  }): Promise<BookingGrpcResponse> {
    if (data.checkInDate >= data.checkOutDate) {
      throw new RpcException(
        '체크아웃 날짜는 체크인 날짜보다 이후여야 합니다.',
      );
    }

    const lastNightDate = addDays(data.checkOutDate, -1);

    const { totalAmount: roomAmount } = await firstValueFrom(
      this.hotelService.reserveRoomAvailability({
        roomId: data.roomId,
        startDate: data.checkInDate,
        endDate: lastNightDate,
      }),
    ).catch((err) => {
      throw new RpcException(
        err?.details || err?.message || '예약 가능한 객실이 아닙니다.',
      );
    });

    const facilitySelections = [
      { name: FACILITY_NAME_INDOOR_POOL, guestCount: data.poolGuestCount ?? 0 },
      { name: FACILITY_NAME_LOUNGE, guestCount: data.loungeGuestCount ?? 0 },
    ].filter((selection) => selection.guestCount > 0);

    let totalAmount = roomAmount;
    const reservationFacilityInputs: {
      facilityId: number;
      facilityName: string;
      guestCount: number;
      totalAmount: number;
    }[] = [];

    if (facilitySelections.length > 0) {
      const { facilities } = await firstValueFrom(
        this.hotelService.getFacilities({ hotelId: data.hotelId }),
      ).catch(() => {
        throw new RpcException('편의시설 정보를 확인할 수 없습니다.');
      });

      for (const selection of facilitySelections) {
        const facility = facilities.find((f) => f.name === selection.name);
        if (!facility) {
          throw new RpcException(
            `해당 호텔에 등록되지 않은 편의시설입니다: ${selection.name}`,
          );
        }
        const facilityAmount = facility.price * selection.guestCount;
        totalAmount += facilityAmount;
        reservationFacilityInputs.push({
          facilityId: facility.facilityId,
          facilityName: facility.name,
          guestCount: selection.guestCount,
          totalAmount: facilityAmount,
        });
      }
    }

    const reservation = this.reservationRepository.create({
      userId: data.userId,
      roomId: data.roomId,
      hotelId: data.hotelId,
      checkInDate: data.checkInDate,
      checkOutDate: data.checkOutDate,
      guestCount: data.guestCount,
      totalAmount,
      status: ReservationStatus.PENDING_PAYMENT,
    });
    const saved = await this.reservationRepository.save(reservation);

    for (const input of reservationFacilityInputs) {
      await this.reservationFacilityService.createReservationFacility({
        reservationId: saved.reservationId,
        facilityId: input.facilityId,
        facilityName: input.facilityName,
        guestCount: input.guestCount,
        totalAmount: input.totalAmount,
      });
    }

    return this.toGrpcResponse(saved);
  }

  // 전체 예약 목록 조회 (관리자 전용, 권한 검증은 api-gateway에서 수행)
  async getBookings(): Promise<BookingGrpcResponse[]> {
    const reservations = await this.reservationRepository.find({
      order: { createdAt: 'DESC' },
    });
    return reservations.map((reservation) => this.toGrpcResponse(reservation));
  }

  // 특정 유저의 예약 목록 조회. userId가 이 서비스의 DB에 존재하지 않아도(유저 존재 여부는
  // 검증할 수 없음, 서비스 간 DB 분리 원칙) 빈 배열을 그대로 반환한다.
  async getBookingsByUserId(userId: number): Promise<BookingGrpcResponse[]> {
    const reservations = await this.reservationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return reservations.map((reservation) => this.toGrpcResponse(reservation));
  }

  // 단건 예약 조회. payment-service가 결제 요청을 검증(금액/소유자/상태)하기 위해 호출한다.
  // 소유자(userId) 검증은 여기서 하지 않고 호출 측(payment-service)에 맡긴다 — 이 서비스의
  // 다른 조회 메서드(getBookings, getBookingsByUserId)도 호출자를 신뢰하고 필터링을 호출 측/
  // api-gateway 권한 검증에 맡기는 것과 같은 원칙이다.
  async getBookingById(reservationId: number): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    return this.toGrpcResponse(reservation);
  }

  // 본인 예약 취소. reservationId가 존재하지 않으면, 혹은 요청자가 예약자 본인이 아니면 RpcException.
  // 이미 취소/완료된 예약도 재취소할 수 없다. PENDING_PAYMENT(결제 전)/RESERVED(결제 완료) 둘 다
  // 취소 가능하다.
  // 1) Reservation.status를 CANCELLED로 먼저 확정한다 (이 서비스의 소스 오브 트루스).
  // 2) hotel-service에 room_availabilities 복구를 요청한다 — 체크아웃 당일은 다음 손님의 체크인일이므로
  //    막지 않고, 체크인일부터 체크아웃 전날까지만 되돌린다. 이 호출이 실패해도 예약 자체는 이미
  //    취소된 상태이므로 요청을 실패시키지 않고 로그만 남긴다(가용일 동기화는 별도로 복구 가능).
  // 3) payment-service에 환불을 요청한다. 취소 전 상태(PENDING_PAYMENT였는지 RESERVED였는지)와
  //    무관하게 항상 호출한다 — PAID 결제가 실제로 있는지 판단은 payment-service가 스스로 하도록
  //    맡긴다(RefundPayment 주석 참고). 이 호출도 hotel-service와 동일하게 실패해도 예약취소
  //    자체는 막지 않고 로그만 남긴다.
  async cancelBooking(
    reservationId: number,
    userId: number,
  ): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    if (reservation.userId !== userId) {
      throw new RpcException('본인의 예약만 취소할 수 있습니다.');
    }
    if (
      reservation.status !== ReservationStatus.PENDING_PAYMENT &&
      reservation.status !== ReservationStatus.RESERVED
    ) {
      throw new RpcException('이미 취소되었거나 완료된 예약입니다.');
    }

    reservation.status = ReservationStatus.CANCELLED;
    const saved = await this.reservationRepository.save(reservation);

    try {
      await firstValueFrom(
        this.hotelService.setRoomAvailability({
          roomId: reservation.roomId,
          startDate: reservation.checkInDate,
          endDate: this.dayBefore(reservation.checkOutDate),
          isAvailable: true,
        }),
      );
    } catch (error) {
      this.logger.error(
        `예약(#${reservationId}) 취소 후 room_availabilities 복구 요청 실패`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    try {
      await firstValueFrom(
        this.paymentService.refundPayment({ reservationId }),
      );
    } catch (error) {
      this.logger.error(
        `예약(#${reservationId}) 취소 후 결제 환불 요청 실패`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    return this.toGrpcResponse(saved);
  }

  // 결제 승인 완료 후 payment-service가 호출: PENDING_PAYMENT -> RESERVED로 전환한다.
  // PENDING_PAYMENT 상태가 아니면(이미 확정됐거나 취소된 예약에 뒤늦게 도달한 콜백 등) 에러.
  async confirmBooking(reservationId: number): Promise<BookingGrpcResponse> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    if (reservation.status !== ReservationStatus.PENDING_PAYMENT) {
      throw new RpcException('결제 대기 상태의 예약이 아닙니다.');
    }

    reservation.status = ReservationStatus.RESERVED;
    const saved = await this.reservationRepository.save(reservation);
    return this.toGrpcResponse(saved);
  }

  // 'YYYY-MM-DD' 문자열을 하루 전 날짜로 변환한다. date 컬럼은 시간 정보가 없으므로 UTC 기준으로
  // 계산해도 타임존에 따라 날짜가 밀리지 않는다.
  private dayBefore(dateStr: string): string {
    const date = new Date(dateStr);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
  }

  private toGrpcResponse(reservation: Reservation): BookingGrpcResponse {
    return {
      reservationId: reservation.reservationId,
      userId: reservation.userId,
      roomId: reservation.roomId,
      hotelId: reservation.hotelId,
      checkInDate: reservation.checkInDate,
      checkOutDate: reservation.checkOutDate,
      guestCount: reservation.guestCount,
      totalAmount: reservation.totalAmount,
      status: reservation.status,
    };
  }

  // 관리자 호텔 상세 페이지의 "호텔별 지표" 섹션용 집계. hotelId 스냅샷 컬럼 덕분에 이 서비스의
  // DB만으로 계산되고, hotel-service 호출은 필요 없다 (점유율의 분모인 "총 객실 수"는 프론트가
  // 이미 갖고 있는 hotel-service의 GetRooms 결과를 그대로 재사용한다 — 이 메서드는 분자만 반환).
  // date를 생략하면 서버 기준 오늘로 계산한다.
  // newReservationsToday는 오늘 생성된 예약 전체가 아니라 "오늘 생성되고 결제까지 확정된"(status=RESERVED)
  // 건만 센다 — PENDING_PAYMENT(결제 대기 중)는 아직 확정된 예약이 아니므로 제외.
  // cancellationsToday는 오늘 취소된(status=CANCELLED) 예약만 센다.
  async getHotelBookingStats(
    hotelId: number,
    date?: string,
  ): Promise<HotelBookingStatsGrpcResponse> {
    const targetDate = date || today();
    // TypeORM QueryBuilder는 'alias.property' 표현에서 엔티티의 TS 프로퍼티명(camelCase)을
    // 기대한다 (실제 DB 컬럼명인 snake_case가 아님) — Reservation 엔티티의 프로퍼티명을 그대로 사용.
    const base = () =>
      this.reservationRepository
        .createQueryBuilder('reservation')
        .where('reservation.hotelId = :hotelId', { hotelId });

    const [
      checkInsToday,
      checkOutsToday,
      occupiedRoomsToday,
      newReservationsToday,
      cancellationsToday,
      revenueResult,
    ] = await Promise.all([
      base()
        .andWhere('reservation.checkInDate = :targetDate', { targetDate })
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .getCount(),
      base()
        .andWhere('reservation.checkOutDate = :targetDate', { targetDate })
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('reservation.checkInDate <= :targetDate', { targetDate })
        .andWhere('reservation.checkOutDate > :targetDate', { targetDate })
        .select('COUNT(DISTINCT reservation.roomId)', 'count')
        .getRawOne<{ count: string }>(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('DATE(reservation.createdAt) = :targetDate', {
          targetDate,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.CANCELLED,
        })
        .andWhere('DATE(reservation.updatedAt) = :targetDate', {
          targetDate,
        })
        .getCount(),
      base()
        .andWhere('reservation.status = :status', {
          status: ReservationStatus.RESERVED,
        })
        .andWhere('DATE(reservation.createdAt) = :targetDate', {
          targetDate,
        })
        .select('SUM(reservation.totalAmount)', 'sum')
        .getRawOne<{ sum: string | null }>(),
    ]);

    return {
      checkInsToday,
      checkOutsToday,
      occupiedRoomsToday: Number(
        (occupiedRoomsToday as { count: string })?.count ?? 0,
      ),
      newReservationsToday,
      cancellationsToday,
      revenueToday: Number((revenueResult as { sum: string | null })?.sum ?? 0),
    };
  }
}
