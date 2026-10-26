import { Controller } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import {
  BookingListQuery,
  BookingServiceService,
} from './booking-service.service';
import { ReservationFacilityService } from './reservation-facility.service';
import { RoomAssignmentService } from './room-assignment.service';
import { AdminBookingService } from './admin-booking.service';

@Controller()
export class BookingServiceController {
  constructor(
    private readonly bookingServiceService: BookingServiceService,
    private readonly reservationFacilityService: ReservationFacilityService,
    private readonly roomAssignmentService: RoomAssignmentService,
    private readonly adminBookingService: AdminBookingService,
  ) {}

  @GrpcMethod('BookingService', 'GetHello')
  getHello(): { message: string } {
    return { message: this.bookingServiceService.getHello() };
  }

  // 관리자 전용: 예약 목록 조회 — 조건·페이지 (LDP-136)
  @GrpcMethod('BookingService', 'GetBookings')
  async getBookings(data: BookingListQuery) {
    return this.bookingServiceService.getBookings(data);
  }

  // 특정 유저의 예약 목록 조회 (/me, /:userId 양쪽에서 재사용)
  @GrpcMethod('BookingService', 'GetBookingsByUserId')
  async getBookingsByUserId(data: { userId: number }) {
    const bookings = await this.bookingServiceService.getBookingsByUserId(
      data.userId,
    );
    return { bookings };
  }

  // 본인 예약 취소
  @GrpcMethod('BookingService', 'CancelBooking')
  async cancelBooking(data: { reservationId: number; userId: number }) {
    return this.bookingServiceService.cancelBooking(
      data.reservationId,
      data.userId,
    );
  }

  // 단건 예약 조회 (payment-service가 결제 요청 검증용으로 호출)
  @GrpcMethod('BookingService', 'GetBookingById')
  async getBookingById(data: { reservationId: number }) {
    return this.bookingServiceService.getBookingById(data.reservationId);
  }

  // 신규 예약 생성
  @GrpcMethod('BookingService', 'CreateBooking')
  async createBooking(data: {
    userId: number;
    roomId: number;
    hotelId: number;
    checkInDate: string;
    checkOutDate: string;
    guestCount: number;
    poolGuestCount?: number;
    loungeGuestCount?: number;
  }) {
    return this.bookingServiceService.createBooking(data);
  }

  // 결제 준비 (위키 API 명세 5.8). api-gateway가 JWT의 userId와 함께 넘긴다.
  @GrpcMethod('BookingService', 'PreparePayment')
  async preparePayment(data: { reservationId: number; userId: number }) {
    return this.bookingServiceService.preparePayment(
      data.reservationId,
      data.userId,
    );
  }

  // 결제 승인 (위키 API 명세 5.9). 토스 결제창(또는 MOCK)이 돌려준 값으로 승인을 요청한다.
  @GrpcMethod('BookingService', 'ConfirmPayment')
  async confirmPayment(data: {
    reservationId: number;
    userId: number;
    paymentKey: string;
    orderId: string;
    amount: number;
  }) {
    return this.bookingServiceService.confirmPayment(data);
  }

  // 특정 예약에 연결된 편의시설 이용 내역 목록 조회
  @GrpcMethod('BookingService', 'GetReservationFacilitiesByReservationId')
  async getReservationFacilitiesByReservationId(data: {
    reservationId: number;
  }) {
    const reservationFacilities =
      await this.reservationFacilityService.getReservationFacilitiesByReservationId(
        data.reservationId,
      );
    return { reservationFacilities };
  }

  // 관리자 호텔 상세 페이지의 "호텔별 지표" 섹션용 집계 조회. date를 생략(빈 문자열)하면
  // 서버 기준 오늘로 계산한다.
  @GrpcMethod('BookingService', 'GetHotelBookingStats')
  async getHotelBookingStats(data: { hotelId: number; date?: string }) {
    return this.bookingServiceService.getHotelBookingStats(
      data.hotelId,
      data.date || undefined,
    );
  }

  // 예약 호실 배정·변경·해제 (roomUnitId 0 = 해제, LDP-89). 관리자 API(PUT /bookings/:id/room-unit)에서 호출
  @GrpcMethod('BookingService', 'AssignRoomUnit')
  async assignRoomUnit(data: { reservationId: number; roomUnitId: number }) {
    return this.roomAssignmentService.assign(
      data.reservationId,
      data.roomUnitId,
    );
  }

  // 호실 배정 현황용 예약 목록 (기간·지점, 결제 대기·예약 확정만, LDP-89)
  @GrpcMethod('BookingService', 'ListUnitAssignments')
  async listUnitAssignments(data: {
    hotelId: number;
    startDate: string;
    endDate: string;
    roomId?: number;
  }) {
    const assignments = await this.roomAssignmentService.listAssignments(data);
    return { assignments };
  }

  // 호실에 남은 미래 배정 수 — 호실을 점검(OUT_OF_SERVICE)으로 바꾸기 전 확인용 (LDP-89)
  @GrpcMethod('BookingService', 'CountFutureUnitAssignments')
  async countFutureUnitAssignments(data: { roomUnitId: number }) {
    const count = await this.roomAssignmentService.countFutureAssignments(
      data.roomUnitId,
    );
    return { count };
  }

  // 관리자 대리 예약 생성 (LDP-90). 회원 존재 확인·직원 이름 조회는 api-gateway에서
  @GrpcMethod('BookingService', 'CreateAdminBooking')
  async createAdminBooking(data: {
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
  }) {
    return this.adminBookingService.createProxyBooking(data);
  }

  // 직원 취소 (LDP-90). 원래 예약이면 연장 예약도 함께 취소
  @GrpcMethod('BookingService', 'AdminCancelBooking')
  async adminCancelBooking(data: {
    reservationId: number;
    adminId: number;
    cancelReason: string;
  }) {
    return this.adminBookingService.cancel(data);
  }

  // 회원의 이용 예정 예약 수 — auth-service가 회원 탈퇴 전에 확인 (LDP-95)
  @GrpcMethod('BookingService', 'CountUpcomingReservations')
  async countUpcomingReservations(data: { userId: number }) {
    const count = await this.bookingServiceService.countUpcomingReservations(
      data.userId,
    );
    return { count };
  }

  // 투숙 연장 예약 생성 (LDP-90)
  @GrpcMethod('BookingService', 'CreateExtensionBooking')
  async createExtensionBooking(data: {
    reservationId: number;
    checkOutDate: string;
    keepSameRoomUnit: boolean;
    adminId: number;
    adminName: string;
  }) {
    return this.adminBookingService.createExtension(data);
  }
}
