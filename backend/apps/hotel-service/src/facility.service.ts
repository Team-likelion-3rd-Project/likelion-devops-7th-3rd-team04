import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Facility } from './entities/facility.entity';
import { Hotel } from './entities/hotel.entity';
import { ReadCache, rpcError } from '@app/common';
import { HotelCacheKeys } from './hotel-cache-keys';

// proto의 Facility 메시지와 1:1 대응되는 응답 형태 (조회 캐시에도 이 모양으로 저장)
export interface FacilityGrpcResponse {
  facilityId: number;
  hotelId: number;
  name: string;
  price: number;
}

@Injectable()
export class FacilityService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
    private readonly cache: ReadCache,
  ) {}

  // 신규 편의시설 등록. hotelId가 존재하지 않으면 RpcException.
  async createFacility(data: {
    hotelId: number;
    name: string;
    price: number;
  }): Promise<Facility> {
    const hotel = await this.hotelRepository.findOne({
      where: { hotelId: data.hotelId },
    });
    if (!hotel) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 호텔입니다.');
    }

    const facility = this.facilityRepository.create({
      hotelId: data.hotelId,
      name: data.name,
      price: data.price,
    });
    const saved = await this.facilityRepository.save(facility);
    await this.cache.invalidate(HotelCacheKeys.facilities(data.hotelId));
    return saved;
  }

  // 특정 호텔의 전체 편의시설 목록 조회 (조회 캐시). hotelId가 존재하지 않으면 RpcException.
  // booking-service가 예약 생성 때마다 편의시설 요금 계산용으로 호출한다.
  async getFacilitiesByHotel(hotelId: number): Promise<FacilityGrpcResponse[]> {
    const facilities = await this.cache.getOrLoad(
      'facilities',
      HotelCacheKeys.facilities(hotelId),
      async () => {
        const hotel = await this.hotelRepository.findOne({
          where: { hotelId },
        });
        if (!hotel) {
          return null;
        }
        const rows = await this.facilityRepository.find({ where: { hotelId } });
        return rows.map((row) => ({
          facilityId: row.facilityId,
          hotelId: row.hotelId,
          name: row.name,
          price: row.price,
        }));
      },
    );
    if (!facilities) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 호텔입니다.');
    }
    return facilities;
  }

  // 단건 편의시설 조회. hotelId/facilityId 조합이 존재하지 않으면 RpcException.
  async getFacilityById(
    hotelId: number,
    facilityId: number,
  ): Promise<Facility> {
    const facility = await this.facilityRepository.findOne({
      where: { hotelId, facilityId },
    });
    if (!facility) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 편의시설입니다.');
    }
    return facility;
  }
}
