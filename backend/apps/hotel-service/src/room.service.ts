import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { Between, DataSource, In, MoreThanOrEqual, Repository } from 'typeorm';
import { Room } from './entities/room.entity';
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
  availabilities: { date: string; isAvailable: boolean; price: number }[];
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room) private readonly roomRepository: Repository<Room>,
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
  // 행이 하루도 빠짐없이 존재하고 전부 isAvailable=true인 객실만 반환한다 (checkOut 당일은 다음 손님의
  // 체크인일이므로 검사 대상에서 제외 — reserveRoomAvailability/createBooking과 동일한 규칙).
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
    const dayMs = 24 * 60 * 60 * 1000;
    const totalNights = Math.round(
      (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / dayMs,
    );

    const availableRows = await this.roomAvailabilityRepository.find({
      where: {
        roomId: In(candidates.map((room) => room.roomId)),
        date: Between(checkIn, lastNight),
        isAvailable: true,
      },
    });
    const availableNightsByRoomId = new Map<number, number>();
    const minPriceByRoomId = new Map<number, number>();
    for (const row of availableRows) {
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

    room.name = data.name;
    room.capacity = data.capacity;
    room.description = data.description;
    const saved = await this.roomRepository.save(room);
    const images = await this.replaceRoomImages(saved.roomId, data.images);
    return this.toGrpcResponse(saved, images);
  }

  // 객실 삭제. hotelId/roomId 조합이 존재하지 않으면 RpcException.
  // rooms/room_images/room_availabilities는 DB 레벨 FK/CASCADE가 없으므로(서비스 간 DB 분리 원칙과
  // 동일하게 이 서비스 내부에서도 관계를 걸지 않음), replaceRoomImages와 동일하게 자식 테이블을
  // 먼저 지운 뒤 부모(rooms) row를 지운다.
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
  // 존재하고 전부 isAvailable=true일 때만 overall isAvailable을 true로 판단한다.
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

    const dayMs = 24 * 60 * 60 * 1000;
    const totalDays =
      Math.round(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / dayMs,
      ) + 1;
    const isAvailable =
      rows.length === totalDays && rows.every((row) => row.isAvailable);

    return {
      hotelId,
      roomId,
      startDate,
      endDate,
      isAvailable,
      availabilities: rows.map((row) => ({
        date: row.date,
        isAvailable: row.isAvailable,
        price: row.price,
      })),
    };
  }

  // 예약 생성/취소 시 예약 가능일을 갱신한다. hotelId 검증 없이 roomId만으로 동작한다
  // (booking-service의 Reservation은 hotelId를 갖고 있지 않음, 서비스 간 DB 분리 원칙).
  // 구간(startDate~endDate, 둘 다 포함) 내에 room_availabilities 행이 없는 날짜는 조용히 건너뛴다
  // (예약 가능일을 채우는 API는 별도 작업 — 지금은 존재하는 행만 갱신).
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
  // room_availabilities row가 하루도 빠짐없이 존재하고 전부 isAvailable=true인지 확인한 뒤, 같은
  // 트랜잭션에서 비관적 락(pessimistic_write)으로 잠그고 전부 isAvailable=false로 전환한다.
  // 동시에 같은 객실을 예약하는 두 요청이 같은 날짜를 동시에 선점하지 못하도록 하기 위함이다.
  async reserveRoomAvailability(
    roomId: number,
    startDate: string,
    endDate: string,
  ): Promise<{ totalAmount: number }> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.find(RoomAvailability, {
        where: { roomId, date: Between(startDate, endDate) },
        order: { date: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });

      const dayMs = 24 * 60 * 60 * 1000;
      const totalDays =
        Math.round(
          (new Date(endDate).getTime() - new Date(startDate).getTime()) /
            dayMs,
        ) + 1;

      if (rows.length !== totalDays || rows.some((row) => !row.isAvailable)) {
        throw new RpcException('예약 불가능한 날짜가 포함되어 있습니다.');
      }

      const totalAmount = rows.reduce((sum, row) => sum + row.price, 0);
      for (const row of rows) {
        row.isAvailable = false;
      }
      await manager.save(rows);

      return { totalAmount };
    });
  }

  private toGrpcResponse(room: Room, images: RoomImage[]): RoomGrpcResponse {
    return {
      roomId: room.roomId,
      hotelId: room.hotelId,
      name: room.name,
      capacity: room.capacity,
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
