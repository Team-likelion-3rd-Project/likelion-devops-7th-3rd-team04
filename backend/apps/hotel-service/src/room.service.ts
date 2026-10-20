import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import {
  Between,
  DataSource,
  In,
  MoreThan,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit } from './entities/room-unit.entity';
import { Hotel } from './entities/hotel.entity';
import { RoomAvailability } from './entities/room-availability.entity';
import { RoomImage } from './entities/room-image.entity';

// 'YYYY-MM-DD' 문자열에 일 단위 offset을 더한 'YYYY-MM-DD' 문자열을 반환한다 (UTC 기준 계산,
// date 컬럼은 시간대 정보가 없으므로 로컬 타임존에 영향받지 않도록 UTC로 계산한다).
function addDays(dateStr: string, offset: number): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

// 오늘 날짜 'YYYY-MM-DD' (UTC). 한국 시간 새벽에는 하루 전 날짜가 되지만, "오늘 이후 예약" 확인에
// 쓰는 값이라 하루 더 넓게 보는 쪽이라 안전하다.
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

// 시작일~종료일(둘 다 포함)의 날짜 수
function countDays(startDate: string, endDate: string): number {
  const dayMs = 24 * 60 * 60 * 1000;
  return (
    Math.round(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / dayMs,
    ) + 1
  );
}

// 이 날짜에 새 예약을 받을 수 있는지: 판매 중이고 남은 방이 1개 이상 (V8 재고 구조)
function isBookable(row: RoomAvailability, totalCount: number): boolean {
  return row.isAvailable && row.bookedCount < totalCount;
}

// proto의 RoomImageInput 메시지와 1:1 대응되는 입력 형태
export interface RoomImageInput {
  mimeType: string;
  imageBase64: string;
}

// proto의 RoomImage 메시지와 1:1 대응되는 응답 형태
export interface RoomImageGrpcResponse {
  imageId: number;
  mimeType: string;
  imageBase64: string;
  sortOrder: number;
}

// proto의 Room 메시지와 1:1 대응되는 응답 형태
export interface RoomGrpcResponse {
  roomId: number;
  hotelId: number;
  name: string;
  capacity: number;
  totalCount: number; // 객실 타입별 보유 수량
  description: string;
  images: RoomImageGrpcResponse[];
}

// proto의 RoomSearchResult 메시지와 1:1 대응되는 응답 형태
export interface RoomSearchResultGrpcResponse {
  room: RoomGrpcResponse;
  minPrice: number;
}

// proto의 RoomAvailabilityResponse 메시지와 1:1 대응되는 응답 형태
export interface RoomAvailabilityGrpcResponse {
  hotelId: number;
  roomId: number;
  startDate: string;
  endDate: string;
  isAvailable: boolean;
  totalCount: number;
  availabilities: {
    date: string;
    isAvailable: boolean; // 예약 가능 = 판매 중 && 남은 방 > 0
    price: number;
    remainingCount: number; // 남은 방 수 (판매 중지여도 그대로 계산)
    isSaleStopped: boolean; // 관리자 판매 중지 여부
  }[];
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomRepository: Repository<RoomType>,
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepository: Repository<RoomUnit>,
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
    @InjectRepository(RoomAvailability)
    private readonly roomAvailabilityRepository: Repository<RoomAvailability>,
    @InjectRepository(RoomImage)
    private readonly roomImageRepository: Repository<RoomImage>,
    private readonly dataSource: DataSource,
  ) {}

  // 신규 객실 등록. hotelId가 존재하지 않으면 RpcException.
  async createRoom(data: {
    hotelId: number;
    name: string;
    capacity: number;
    totalCount?: number;
    description?: string;
    images?: RoomImageInput[];
  }): Promise<RoomGrpcResponse> {
    const hotel = await this.hotelRepository.findOne({
      where: { hotelId: data.hotelId },
    });
    if (!hotel) {
      throw new RpcException('존재하지 않는 호텔입니다.');
    }

    const room = this.roomRepository.create({
      hotelId: data.hotelId,
      name: data.name,
      capacity: data.capacity,
      // proto3는 값을 안 보내면 0이 온다 → 보유 수량을 안 정했으면 1개
      totalCount: data.totalCount || 1,
      description: data.description,
    });
    const saved = await this.roomRepository.save(room);
    const images = await this.replaceRoomImages(saved.roomId, data.images);
    return this.toGrpcResponse(saved, images);
  }

  // 특정 호텔의 전체 객실 목록 조회. hotelId가 존재하지 않으면 RpcException.
  async getRoomsByHotel(hotelId: number): Promise<RoomGrpcResponse[]> {
    const hotel = await this.hotelRepository.findOne({
      where: { hotelId },
    });
    if (!hotel) {
      throw new RpcException('존재하지 않는 호텔입니다.');
    }

    const rooms = await this.roomRepository.find({ where: { hotelId } });
    if (rooms.length === 0) {
      return [];
    }

    const images = await this.roomImageRepository.find({
      where: { roomId: In(rooms.map((room) => room.roomId)) },
      order: { sortOrder: 'ASC' },
    });
    const imagesByRoomId = new Map<number, RoomImage[]>();
    for (const image of images) {
      const bucket = imagesByRoomId.get(image.roomId) ?? [];
      bucket.push(image);
      imagesByRoomId.set(image.roomId, bucket);
    }

    return rooms.map((room) =>
      this.toGrpcResponse(room, imagesByRoomId.get(room.roomId) ?? []),
    );
  }

  // 단건 객실 조회. hotelId/roomId 조합이 존재하지 않으면 RpcException.
  async getRoomById(
    hotelId: number,
    roomId: number,
  ): Promise<RoomGrpcResponse> {
    const room = await this.roomRepository.findOne({
      where: { hotelId, roomId },
    });
    if (!room) {
      throw new RpcException('존재하지 않는 객실입니다.');
    }
    const images = await this.roomImageRepository.find({
      where: { roomId },
      order: { sortOrder: 'ASC' },
    });
    return this.toGrpcResponse(room, images);
  }

  // 예약 가능 객실 검색. hotelId가 존재하지 않으면 RpcException.
  // capacity가 guests 이상인 객실 중, checkIn~(checkOut 하루 전)까지 모든 날짜의 room_availabilities
  // 행이 하루도 빠짐없이 존재하고 전부 "판매 중 + 남은 방 1개 이상"인 객실만 반환한다 (checkOut 당일은
  // 다음 손님의 체크인일이므로 검사 대상에서 제외 — reserveRoomAvailability/createBooking과 동일한 규칙).
  // 이 검증 과정에서 이미 조회한 row.price로 minPrice(구간 중 최저 1박 요금)도 추가 쿼리 없이 함께 계산한다.
  async searchAvailableRooms(
    hotelId: number,
    checkIn: string,
    checkOut: string,
    guests: number,
  ): Promise<RoomSearchResultGrpcResponse[]> {
    const hotel = await this.hotelRepository.findOne({ where: { hotelId } });
    if (!hotel) {
      throw new RpcException('존재하지 않는 호텔입니다.');
    }

    const candidates = await this.roomRepository.find({
      where: { hotelId, capacity: MoreThanOrEqual(guests) },
    });
    if (candidates.length === 0) {
      return [];
    }

    const lastNight = addDays(checkOut, -1);
    const totalNights = countDays(checkIn, lastNight);
    const totalCountByRoomId = new Map(
      candidates.map((room) => [room.roomId, room.totalCount]),
    );

    const onSaleRows = await this.roomAvailabilityRepository.find({
      where: {
        roomId: In(candidates.map((room) => room.roomId)),
        date: Between(checkIn, lastNight),
        isAvailable: true,
      },
    });
    const availableNightsByRoomId = new Map<number, number>();
    const minPriceByRoomId = new Map<number, number>();
    for (const row of onSaleRows) {
      // 판매 중이어도 그 날 방이 다 찼으면(매진) 예약 가능한 밤으로 세지 않는다
      if (row.bookedCount >= (totalCountByRoomId.get(row.roomId) ?? 0)) {
        continue;
      }
      availableNightsByRoomId.set(
        row.roomId,
        (availableNightsByRoomId.get(row.roomId) ?? 0) + 1,
      );
      const currentMin = minPriceByRoomId.get(row.roomId);
      if (currentMin === undefined || row.price < currentMin) {
        minPriceByRoomId.set(row.roomId, row.price);
      }
    }

    const availableRooms = candidates.filter(
      (room) => availableNightsByRoomId.get(room.roomId) === totalNights,
    );
    if (availableRooms.length === 0) {
      return [];
    }

    const images = await this.roomImageRepository.find({
      where: { roomId: In(availableRooms.map((room) => room.roomId)) },
      order: { sortOrder: 'ASC' },
    });
    const imagesByRoomId = new Map<number, RoomImage[]>();
    for (const image of images) {
      const bucket = imagesByRoomId.get(image.roomId) ?? [];
      bucket.push(image);
      imagesByRoomId.set(image.roomId, bucket);
    }

    return availableRooms.map((room) => ({
      room: this.toGrpcResponse(room, imagesByRoomId.get(room.roomId) ?? []),
      minPrice: minPriceByRoomId.get(room.roomId) ?? 0,
    }));
  }

  // 기존 객실 정보 수정. hotelId/roomId 조합이 존재하지 않으면 RpcException.
  // images는 항상 전체 교체(PUT 시맨틱) — 기존 이미지를 유지하려면 그대로 포함해서 다시 보내야 한다.
  async updateRoom(
    hotelId: number,
    roomId: number,
    data: {
      name: string;
      capacity: number;
      totalCount?: number;
      description?: string;
      images?: RoomImageInput[];
    },
  ): Promise<RoomGrpcResponse> {
    const room = await this.roomRepository.findOne({
      where: { hotelId, roomId },
    });
    if (!room) {
      throw new RpcException('존재하지 않는 객실입니다.');
    }

    // 보유 수량은 보냈을 때만 바꾼다 (proto3에서 안 보내면 0). 오늘 이후 이미 예약된 수보다 적게는 못 줄인다
    // — 줄이면 이미 받은 예약이 보유 수량을 넘게 된다.
    if (data.totalCount && data.totalCount !== room.totalCount) {
      const maxBooked = await this.roomAvailabilityRepository.maximum(
        'bookedCount',
        { roomId, date: MoreThanOrEqual(todayUtc()) },
      );
      if ((maxBooked ?? 0) > data.totalCount) {
        throw new RpcException(
          `이미 예약된 수(최대 ${maxBooked}개)보다 보유 수량을 적게 줄일 수 없습니다.`,
        );
      }
      room.totalCount = data.totalCount;
    }

    room.name = data.name;
    room.capacity = data.capacity;
    room.description = data.description;
    const saved = await this.roomRepository.save(room);
    const images = await this.replaceRoomImages(saved.roomId, data.images);
    return this.toGrpcResponse(saved, images);
  }

  // 객실(객실 종류) 삭제. hotelId/roomId 조합이 존재하지 않으면 RpcException.
  // 이미지·날짜별 재고를 먼저 지운 뒤 객실 종류를 지운다 (DB에도 CASCADE FK가 있지만 명시적으로 정리).
  // 호실(rooms)이 남아 있으면 삭제하지 않는다 — 호실에 배정된 예약이 엉키지 않도록 DB도 RESTRICT FK로 막는다 (V9).
  // 호실은 삭제 대신 점검(OUT_OF_SERVICE) 처리한다.
  async deleteRoom(
    hotelId: number,
    roomId: number,
  ): Promise<{ success: boolean }> {
    const room = await this.roomRepository.findOne({
      where: { hotelId, roomId },
    });
    if (!room) {
      throw new RpcException('존재하지 않는 객실입니다.');
    }
    const unitCount = await this.roomUnitRepository.count({
      where: { roomId },
    });
    if (unitCount > 0) {
      throw new RpcException(
        `호실이 ${unitCount}개 남아 있는 객실 종류는 삭제할 수 없습니다.`,
      );
    }

    await this.roomImageRepository.delete({ roomId });
    await this.roomAvailabilityRepository.delete({ roomId });
    await this.roomRepository.delete({ hotelId, roomId });

    return { success: true };
  }

  // roomId에 연결된 이미지를 전달받은 목록으로 완전히 교체한다 (기존 삭제 후 재삽입).
  private async replaceRoomImages(
    roomId: number,
    images?: RoomImageInput[],
  ): Promise<RoomImage[]> {
    await this.roomImageRepository.delete({ roomId });
    if (!images || images.length === 0) {
      return [];
    }

    const entities = images.map((image, index) =>
      this.roomImageRepository.create({
        roomId,
        mimeType: image.mimeType,
        imageBase64: image.imageBase64,
        sortOrder: index,
      }),
    );
    return this.roomImageRepository.save(entities);
  }

  // 특정 기간 예약 가능 여부 조회. hotelId/roomId 조합이 존재하지 않으면 RpcException.
  // 구간(startDate~endDate, 둘 다 포함) 전체에 대해 room_availabilities 행이 하루도 빠짐없이
  // 존재하고 전부 "판매 중 + 남은 방 1개 이상"일 때만 overall isAvailable을 true로 판단한다.
  // 날짜별로 남은 방 수(remainingCount)와 판매 중지 여부(isSaleStopped)를 따로 내려 줘서
  // 화면에서 "매진"(남은 방 0)과 "판매 중지"를 구분할 수 있다.
  async getRoomAvailability(
    hotelId: number,
    roomId: number,
    startDate: string,
    endDate: string,
  ): Promise<RoomAvailabilityGrpcResponse> {
    const room = await this.roomRepository.findOne({
      where: { hotelId, roomId },
    });
    if (!room) {
      throw new RpcException('존재하지 않는 객실입니다.');
    }

    const rows = await this.roomAvailabilityRepository.find({
      where: { roomId, date: Between(startDate, endDate) },
      order: { date: 'ASC' },
    });

    const isAvailable =
      rows.length === countDays(startDate, endDate) &&
      rows.every((row) => isBookable(row, room.totalCount));

    return {
      hotelId,
      roomId,
      startDate,
      endDate,
      isAvailable,
      totalCount: room.totalCount,
      availabilities: rows.map((row) => ({
        date: row.date,
        isAvailable: isBookable(row, room.totalCount),
        price: row.price,
        remainingCount: Math.max(room.totalCount - row.bookedCount, 0),
        isSaleStopped: !row.isAvailable,
      })),
    };
  }

  // 관리자 판매 중지/재개 (isAvailable=false → 판매 중지, true → 판매 재개). roomId만으로 동작한다.
  // 판매 상태(is_available)만 바꾸고 예약 수(booked_count)는 그대로 둔다 — 판매 중지해도 그 날의
  // 기존 예약은 유지되고, 새 예약만 막힌다. 예약·취소는 이 메서드가 아니라
  // reserveRoomAvailability / releaseRoomAvailability를 쓴다 (V8부터).
  // 구간(startDate~endDate, 둘 다 포함) 내에 room_availabilities 행이 없는 날짜는 조용히 건너뛴다.
  async setRoomAvailability(
    roomId: number,
    startDate: string,
    endDate: string,
    isAvailable: boolean,
  ): Promise<{ success: boolean }> {
    await this.roomAvailabilityRepository.update(
      { roomId, date: Between(startDate, endDate) },
      { isAvailable },
    );
    return { success: true };
  }

  // booking-service 전용: 예약 생성 시 호출된다. roomId의 지정 기간(startDate~endDate, 둘 다 포함)에
  // room_availabilities row가 하루도 빠짐없이 존재하고 전부 "판매 중 + 남은 방 1개 이상"인지 확인한 뒤,
  // 같은 트랜잭션에서 날짜별 booked_count를 1씩 올린다.
  // 행을 비관적 락(pessimistic_write)으로 잠그고 확인하므로, 같은 객실 타입·같은 날짜에 동시에 예약이
  // 들어와도 한 요청씩 차례로 처리된다 → 성공 건수가 남은 방 수를 넘지 않는다.
  async reserveRoomAvailability(
    roomId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ totalAmount: number }> {
    return this.dataSource.transaction(async (manager) => {
      const room = await manager.findOne(RoomType, { where: { roomId } });
      if (!room) {
        throw new RpcException('존재하지 않는 객실입니다.');
      }

      const rows = await manager.find(RoomAvailability, {
        where: { roomId, date: Between(startDate, endDate) },
        order: { date: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      if (
        rows.length !== countDays(startDate, endDate) ||
        rows.some((row) => !isBookable(row, room.totalCount))
      ) {
        throw new RpcException('예약 불가능한 날짜가 포함되어 있습니다.');
      }

      await manager.increment(
        RoomAvailability,
        { roomId, date: Between(startDate, endDate) },
        'bookedCount',
        1,
      );

      const totalAmount = rows.reduce((sum, row) => sum + row.price, 0);
      return { totalAmount };
    });
  }

  // booking-service 전용: 예약이 취소·결제 실패·만료로 풀릴 때 호출된다. 지정 기간의 날짜별 booked_count를
  // 1씩 내린다 (남은 방 +1). 판매 중지 여부(is_available)는 건드리지 않는다 — 관리자가 막아 둔 날은
  // 예약이 취소돼도 계속 막혀 있다.
  // booked_count가 이미 0인 날짜는 건너뛴다 (V8 이전에 만든 예약을 취소하는 경우 등, 음수 방지).
  async releaseRoomAvailability(
    roomId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ success: boolean }> {
    await this.roomAvailabilityRepository.decrement(
      { roomId, date: Between(startDate, endDate), bookedCount: MoreThan(0) },
      'bookedCount',
      1,
    );
    return { success: true };
  }

  private toGrpcResponse(
    room: RoomType,
    images: RoomImage[],
  ): RoomGrpcResponse {
    return {
      roomId: room.roomId,
      hotelId: room.hotelId,
      name: room.name,
      capacity: room.capacity,
      totalCount: room.totalCount,
      description: room.description ?? '',
      images: images.map((image) => ({
        imageId: image.imageId,
        mimeType: image.mimeType,
        imageBase64: image.imageBase64,
        sortOrder: image.sortOrder,
      })),
    };
  }
}
