import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Repository } from 'typeorm';
import { Facility } from './entities/facility.entity';
import { Hotel } from './entities/hotel.entity';

@Injectable()
export class FacilityService {
  constructor(
    @InjectRepository(Facility)
    private readonly facilityRepository: Repository<Facility>,
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
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
      throw new RpcException('존재하지 않는 호텔입니다.');
    }

    const facility = this.facilityRepository.create({
      hotelId: data.hotelId,
      name: data.name,
      price: data.price,
    });
    return this.facilityRepository.save(facility);
  }

  // 특정 호텔의 전체 편의시설 목록 조회. hotelId가 존재하지 않으면 RpcException.
  async getFacilitiesByHotel(hotelId: number): Promise<Facility[]> {
    const hotel = await this.hotelRepository.findOne({ where: { hotelId } });
    if (!hotel) {
      throw new RpcException('존재하지 않는 호텔입니다.');
    }
    return this.facilityRepository.find({ where: { hotelId } });
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
      throw new RpcException('존재하지 않는 편의시설입니다.');
    }
    return facility;
  }
}
