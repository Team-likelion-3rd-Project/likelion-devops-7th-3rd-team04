import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { ReservationFacility } from './entities/reservation-facility.entity';
import { Reservation } from './entities/reservation.entity';

// proto의 ReservationFacilityItem 메시지와 1:1 대응되는 응답 형태
export interface ReservationFacilityGrpcResponse {
  reservationFacilityId: number;
  reservationId: number;
  facilityId: number;
  facilityName: string;
  guestCount: number;
  totalAmount: number;
}

@Injectable()
export class ReservationFacilityService {
  constructor(
    @InjectRepository(ReservationFacility)
    private readonly reservationFacilityRepository: Repository<ReservationFacility>,
    @InjectRepository(Reservation)
    private readonly reservationRepository: Repository<Reservation>,
  ) {}

  // 예약에 편의시설 이용 내역을 추가한다. reservationId가 존재하지 않으면 RpcException.
  // facilityId는 hotel-service의 Facility를 가리키지만(서비스 간 DB 분리 원칙에 따라 FK 없이
  // 정수 컬럼으로만 저장), 여기서는 존재 여부를 검증하지 않는다 — 호출 측이 hotel-service를 통해
  // 미리 확인했다고 가정한다 (Reservation.roomId 검증을 hotel-service의 ReserveRoomAvailability에
  // 맡기는 것과 같은 원칙).
  async createReservationFacility(data: {
    reservationId: number;
    facilityId: number;
    facilityName: string;
    guestCount: number;
    totalAmount: number;
  }): Promise<ReservationFacility> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId: data.reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }

    const reservationFacility = this.reservationFacilityRepository.create({
      reservationId: data.reservationId,
      facilityId: data.facilityId,
      facilityName: data.facilityName,
      guestCount: data.guestCount,
      totalAmount: data.totalAmount,
    });
    return this.reservationFacilityRepository.save(reservationFacility);
  }

  // 특정 예약에 연결된 편의시설 이용 내역 목록 조회. reservationId가 존재하지 않으면 RpcException.
  // payment-service 등 다른 서비스가 예약 금액 상세 내역을 확인할 때 호출할 수 있도록 gRPC로도
  // 노출한다 (booking-service.controller.ts의 GetReservationFacilitiesByReservationId 참고).
  async getReservationFacilitiesByReservationId(
    reservationId: number,
  ): Promise<ReservationFacilityGrpcResponse[]> {
    const reservation = await this.reservationRepository.findOne({
      where: { reservationId },
    });
    if (!reservation) {
      throw new RpcException('존재하지 않는 예약입니다.');
    }
    const reservationFacilities = await this.reservationFacilityRepository.find(
      {
        where: { reservationId },
      },
    );
    return reservationFacilities.map((rf) => this.toGrpcResponse(rf));
  }

  private toGrpcResponse(
    reservationFacility: ReservationFacility,
  ): ReservationFacilityGrpcResponse {
    return {
      reservationFacilityId: reservationFacility.reservationFacilityId,
      reservationId: reservationFacility.reservationId,
      facilityId: reservationFacility.facilityId,
      facilityName: reservationFacility.facilityName,
      guestCount: reservationFacility.guestCount,
      totalAmount: reservationFacility.totalAmount,
    };
  }
}
