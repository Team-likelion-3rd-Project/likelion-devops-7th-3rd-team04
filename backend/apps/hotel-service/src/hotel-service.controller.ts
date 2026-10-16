import { Controller, Get } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { HotelServiceService } from './hotel-service.service';
import { RoomImageInput, RoomService } from './room.service';
import { FacilityService } from './facility.service';

@Controller()
export class HotelServiceController {
  constructor(
    private readonly hotelServiceService: HotelServiceService,
    private readonly roomService: RoomService,
    private readonly facilityService: FacilityService,
  ) {}

  // proto의 HotelService / GetHello 메서드와 매핑
  @GrpcMethod('HotelService', 'GetHello')
  getHello(): { message: string } {
    return { message: this.hotelServiceService.getHello() };
  }

  // proto의 HotelService / GetHotels 메서드와 매핑: 전체 호텔 목록 조회
  @GrpcMethod('HotelService', 'GetHotels')
  async getHotels() {
    const hotels = await this.hotelServiceService.getHotels();
    return { hotels };
  }

  // proto의 HotelService / GetHotel 메서드와 매핑: 단건 호텔 조회
  @GrpcMethod('HotelService', 'GetHotel')
  async getHotel(data: { hotelId: number }) {
    return this.hotelServiceService.getHotel(data.hotelId);
  }

  // proto의 HotelService / UpdateHotel 메서드와 매핑: 기존 호텔 정보 수정 (관리자 전용, api-gateway에서 권한 검증)
  @GrpcMethod('HotelService', 'UpdateHotel')
  async updateHotel(data: {
    hotelId: number;
    name: string;
    address: string;
    phoneNumber: string;
    description: string;
  }) {
    return this.hotelServiceService.updateHotel(data.hotelId, data);
  }

  // proto의 HotelService / GetRooms 메서드와 매핑: 특정 호텔의 전체 객실 목록 조회
  @GrpcMethod('HotelService', 'GetRooms')
  async getRooms(data: { hotelId: number }) {
    const rooms = await this.roomService.getRoomsByHotel(data.hotelId);
    return { rooms };
  }

  // proto의 HotelService / GetRoom 메서드와 매핑: 단건 객실 조회
  @GrpcMethod('HotelService', 'GetRoom')
  async getRoom(data: { hotelId: number; roomId: number }) {
    return this.roomService.getRoomById(data.hotelId, data.roomId);
  }

  // proto의 HotelService / SearchRooms 메서드와 매핑: 체크인/체크아웃/인원수 조건으로 예약 가능한 객실 검색
  @GrpcMethod('HotelService', 'SearchRooms')
  async searchRooms(data: {
    hotelId: number;
    checkIn: string;
    checkOut: string;
    guests: number;
  }) {
    const results = await this.roomService.searchAvailableRooms(
      data.hotelId,
      data.checkIn,
      data.checkOut,
      data.guests,
    );
    return { results };
  }

  // proto의 HotelService / CreateRoom 메서드와 매핑: 신규 객실 등록 (관리자 전용, api-gateway에서 권한 검증)
  @GrpcMethod('HotelService', 'CreateRoom')
  async createRoom(data: {
    hotelId: number;
    name: string;
    capacity: number;
    totalCount?: number;
    description: string;
    images?: RoomImageInput[];
  }) {
    return this.roomService.createRoom(data);
  }

  // proto의 HotelService / UpdateRoom 메서드와 매핑: 기존 객실 정보 수정 (관리자 전용, api-gateway에서 권한 검증)
  @GrpcMethod('HotelService', 'UpdateRoom')
  async updateRoom(data: {
    hotelId: number;
    roomId: number;
    name: string;
    capacity: number;
    totalCount?: number;
    description: string;
    images?: RoomImageInput[];
  }) {
    return this.roomService.updateRoom(data.hotelId, data.roomId, data);
  }

  // proto의 HotelService / DeleteRoom 메서드와 매핑: 객실 삭제 (관리자 전용, api-gateway에서 권한 검증)
  @GrpcMethod('HotelService', 'DeleteRoom')
  async deleteRoom(data: { hotelId: number; roomId: number }) {
    return this.roomService.deleteRoom(data.hotelId, data.roomId);
  }

  // proto의 HotelService / GetRoomAvailability 메서드와 매핑: 특정 기간 객실 예약 가능 여부 조회
  @GrpcMethod('HotelService', 'GetRoomAvailability')
  async getRoomAvailability(data: {
    hotelId: number;
    roomId: number;
    startDate: string;
    endDate: string;
  }) {
    return this.roomService.getRoomAvailability(
      data.hotelId,
      data.roomId,
      data.startDate,
      data.endDate,
    );
  }

  // proto의 HotelService / SetRoomAvailability 메서드와 매핑: 관리자 판매 중지/재개 (예약 수는 그대로)
  @GrpcMethod('HotelService', 'SetRoomAvailability')
  async setRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
    isAvailable: boolean;
  }) {
    return this.roomService.setRoomAvailability(
      data.roomId,
      data.startDate,
      data.endDate,
      data.isAvailable,
    );
  }

  // proto의 HotelService / ReserveRoomAvailability 메서드와 매핑: booking-service가 예약 생성 시 호출
  @GrpcMethod('HotelService', 'ReserveRoomAvailability')
  async reserveRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
  }) {
    return this.roomService.reserveRoomAvailability(
      data.roomId,
      data.startDate,
      data.endDate,
    );
  }

  // proto의 HotelService / ReleaseRoomAvailability 메서드와 매핑: booking-service가 예약 취소·결제 실패 시 호출
  @GrpcMethod('HotelService', 'ReleaseRoomAvailability')
  async releaseRoomAvailability(data: {
    roomId: number;
    startDate: string;
    endDate: string;
  }) {
    return this.roomService.releaseRoomAvailability(
      data.roomId,
      data.startDate,
      data.endDate,
    );
  }

  // proto의 HotelService / CreateFacility 메서드와 매핑: 신규 편의시설 등록 (관리자 전용, api-gateway에서 권한 검증)
  @GrpcMethod('HotelService', 'CreateFacility')
  async createFacility(data: { hotelId: number; name: string; price: number }) {
    return this.facilityService.createFacility(data);
  }

  // proto의 HotelService / GetFacilities 메서드와 매핑: 특정 호텔의 전체 편의시설 목록 조회
  // (booking-service가 예약 생성 시 편의시설 요금 조회 용도로 호출)
  @GrpcMethod('HotelService', 'GetFacilities')
  async getFacilities(data: { hotelId: number }) {
    const facilities = await this.facilityService.getFacilitiesByHotel(
      data.hotelId,
    );
    return { facilities };
  }

  // DB 연결 확인 엔드포인트 (GET /db-check)
  @Get('db-check')
  async checkDb() {
    return await this.hotelServiceService.testConnection();
  }
}
