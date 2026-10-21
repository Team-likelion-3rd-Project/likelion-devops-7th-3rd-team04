import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  In,
  MoreThanOrEqual,
  QueryFailedError,
  Repository,
} from 'typeorm';
import { apiRpcException } from '@app/common';
import { Hotel } from './entities/hotel.entity';
import { RoomType } from './entities/room-type.entity';
import { RoomUnit, RoomUnitStatus } from './entities/room-unit.entity';
import { RoomAvailability } from './entities/room-availability.entity';

// proto의 RoomUnit 메시지와 1:1 대응
export interface RoomUnitGrpcResponse {
  roomUnitId: number;
  roomId: number;
  roomName: string;
  hotelId: number;
  roomNumber: string;
  floor: number; // 없으면 0
  status: string;
}

// 오늘 날짜 'YYYY-MM-DD' (UTC). "오늘 이후 예약 수" 확인에 쓰는 값이라, 한국 시간 새벽에 하루 전 날짜가
// 되더라도 하루 더 넓게 보는 쪽이라 안전하다 (room.service.ts의 todayUtc와 같은 규칙).
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string })?.code === 'ER_DUP_ENTRY'
  );
}

// 호실(실제 방) 관리 — LDP-89.
// 객실 종류(room_types) 아래 실제 호실(rooms: 201호 등)을 관리하고, 보유 수량(room_types.total_count)을
// ACTIVE 호실 수로 맞춘다. 호실을 추가·점검·해제할 때마다 객실 종류 행을 잠그고(비관적 락) 같은
// 트랜잭션에서 수량을 다시 세서, 동시에 바뀌어도 보유 수량과 호실 수가 어긋나지 않게 한다.
// 예약 받기(재고)는 지금처럼 보유 수량 기준이고, 실제 호실 배정은 booking-service가 맡는다.
@Injectable()
export class RoomUnitService {
  constructor(
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
    @InjectRepository(RoomType)
    private readonly roomTypeRepository: Repository<RoomType>,
    @InjectRepository(RoomUnit)
    private readonly roomUnitRepository: Repository<RoomUnit>,
    private readonly dataSource: DataSource,
  ) {}

  // 호실 목록. roomId(객실 종류)를 주면 그 종류만, status를 주면 그 상태만.
  async listUnits(
    hotelId: number,
    roomId?: number,
    status?: string,
  ): Promise<RoomUnitGrpcResponse[]> {
    const hotel = await this.hotelRepository.findOne({ where: { hotelId } });
    if (!hotel) {
      throw this.notFound('HOTEL_NOT_FOUND', '존재하지 않는 호텔입니다.');
    }
    if (roomId) {
      await this.findRoomType(this.roomTypeRepository.manager, hotelId, roomId);
    }
    const statusFilter = this.parseStatus(status, true);

    const units = await this.roomUnitRepository.find({
      where: {
        hotelId,
        ...(roomId ? { roomId } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      order: { roomNumber: 'ASC' },
    });
    return this.withRoomNames(units);
  }

  // 호실 ID로 조회 (booking-service의 배정 검증·방 번호 표시용). 없는 ID는 결과에서 빠진다.
  async getUnitsByIds(roomUnitIds: number[]): Promise<RoomUnitGrpcResponse[]> {
    const ids = [...new Set(roomUnitIds.filter((id) => id > 0))];
    if (ids.length === 0) {
      return [];
    }
    const units = await this.roomUnitRepository.find({
      where: { roomUnitId: In(ids) },
    });
    return this.withRoomNames(units);
  }

  // 호실 추가. ACTIVE로 만들고 보유 수량을 ACTIVE 호실 수로 다시 맞춘다.
  async createUnit(data: {
    hotelId: number;
    roomId: number;
    roomNumber: string;
    floor?: number;
  }): Promise<RoomUnitGrpcResponse> {
    const roomNumber = this.normalizeRoomNumber(data.roomNumber);
    const saved = await this.dataSource
      .transaction(async (manager) => {
        const roomType = await this.findRoomType(
          manager,
          data.hotelId,
          data.roomId,
          true,
        );
        const unit = await manager.save(
          manager.create(RoomUnit, {
            roomId: roomType.roomId,
            hotelId: roomType.hotelId,
            roomNumber,
            floor: data.floor || null,
            status: RoomUnitStatus.ACTIVE,
          }),
        );
        await this.syncTotalCount(manager, roomType.roomId);
        return unit;
      })
      .catch((error: unknown) => {
        throw this.duplicateRoomNumber(error, roomNumber);
      });
    const [response] = await this.withRoomNames([saved]);
    return response;
  }

  // 호실 방 번호·층 수정 (상태는 setStatus로만 바꾼다).
  async updateUnit(data: {
    hotelId: number;
    roomUnitId: number;
    roomNumber: string;
    floor?: number;
  }): Promise<RoomUnitGrpcResponse> {
    const roomNumber = this.normalizeRoomNumber(data.roomNumber);
    const unit = await this.findUnit(data.hotelId, data.roomUnitId);
    unit.roomNumber = roomNumber;
    unit.floor = data.floor || null;
    const saved = await this.roomUnitRepository
      .save(unit)
      .catch((error: unknown) => {
        throw this.duplicateRoomNumber(error, roomNumber);
      });
    const [response] = await this.withRoomNames([saved]);
    return response;
  }

  // 점검(OUT_OF_SERVICE) 처리·해제(ACTIVE). 보유 수량을 ACTIVE 호실 수로 다시 맞춘다.
  // 점검으로 보유 수량이 줄 때, 오늘 이후 어느 날이든 그 객실 종류의 예약 수(booked_count)가 새 보유 수량보다
  // 많으면 거절한다 — 이미 받은 예약이 방보다 많아지는 오버부킹을 막는다.
  // 이 호실에 배정된 미래 예약이 있는지는 api-gateway가 booking-service에 먼저 확인한다 (서비스끼리 서로
  // 부르는 순환을 만들지 않으려고).
  async setStatus(data: {
    hotelId: number;
    roomUnitId: number;
    status: string;
  }): Promise<RoomUnitGrpcResponse> {
    const status = this.parseStatus(data.status, false) as RoomUnitStatus;
    const saved = await this.dataSource.transaction(async (manager) => {
      // 잠그는 읽기(locking read)로 시작해야 한다: 보통 읽기를 먼저 하면 그 시점의 스냅샷이 고정돼,
      // 아래에서 객실 종류 락을 기다리는 동안 다른 요청이 바꾼 호실 상태·예약 수를 못 보고 판단하게 된다.
      const unit = await manager.findOne(RoomUnit, {
        where: { roomUnitId: data.roomUnitId, hotelId: data.hotelId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!unit) {
        throw this.notFound('ROOM_UNIT_NOT_FOUND', '존재하지 않는 호실입니다.');
      }
      // 같은 객실 종류의 호실 변경·예약 생성(공유 락)과 한 줄로 세운다 (보유 수량 계산이 엇갈리지 않게)
      await this.findRoomType(manager, unit.hotelId, unit.roomId, true);
      if (unit.status === status) {
        return unit;
      }

      if (status === RoomUnitStatus.OUT_OF_SERVICE) {
        const activeCount = await manager.count(RoomUnit, {
          where: { roomId: unit.roomId, status: RoomUnitStatus.ACTIVE },
        });
        const maxBooked =
          (await manager.maximum(RoomAvailability, 'bookedCount', {
            roomId: unit.roomId,
            date: MoreThanOrEqual(todayUtc()),
          })) ?? 0;
        if (maxBooked > activeCount - 1) {
          throw apiRpcException({
            status: 409,
            code: 'ROOM_UNIT_OVERBOOKING',
            message: `이 호실을 점검하면 사용 가능한 방(${activeCount - 1}개)보다 이미 받은 예약(최대 ${maxBooked}건)이 많아집니다.`,
            retryable: false,
          });
        }
      }

      unit.status = status;
      const updated = await manager.save(unit);
      await this.syncTotalCount(manager, unit.roomId);
      return updated;
    });
    const [response] = await this.withRoomNames([saved]);
    return response;
  }

  // 보유 수량 = ACTIVE 호실 수
  private async syncTotalCount(
    manager: EntityManager,
    roomId: number,
  ): Promise<void> {
    const activeCount = await manager.count(RoomUnit, {
      where: { roomId, status: RoomUnitStatus.ACTIVE },
    });
    await manager.update(RoomType, { roomId }, { totalCount: activeCount });
  }

  // 객실 종류가 그 지점 것인지 확인. lock이면 객실 종류 행을 잠근다.
  private async findRoomType(
    manager: EntityManager,
    hotelId: number,
    roomId: number,
    lock = false,
  ): Promise<RoomType> {
    const roomType = await manager.findOne(RoomType, {
      where: { hotelId, roomId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!roomType) {
      throw this.notFound('ROOM_NOT_FOUND', '존재하지 않는 객실입니다.');
    }
    return roomType;
  }

  private async findUnit(
    hotelId: number,
    roomUnitId: number,
  ): Promise<RoomUnit> {
    const unit = await this.roomUnitRepository.findOne({
      where: { roomUnitId, hotelId },
    });
    if (!unit) {
      throw this.notFound('ROOM_UNIT_NOT_FOUND', '존재하지 않는 호실입니다.');
    }
    return unit;
  }

  private async withRoomNames(
    units: RoomUnit[],
  ): Promise<RoomUnitGrpcResponse[]> {
    if (units.length === 0) {
      return [];
    }
    const roomTypes = await this.roomTypeRepository.find({
      where: { roomId: In([...new Set(units.map((unit) => unit.roomId))]) },
    });
    const nameById = new Map(roomTypes.map((type) => [type.roomId, type.name]));
    return units.map((unit) => ({
      roomUnitId: unit.roomUnitId,
      roomId: unit.roomId,
      roomName: nameById.get(unit.roomId) ?? '',
      hotelId: unit.hotelId,
      roomNumber: unit.roomNumber,
      floor: unit.floor ?? 0,
      status: unit.status,
    }));
  }

  // 빈 값이면 null(필터 없음) — allowEmpty일 때만. 그 외 ACTIVE / OUT_OF_SERVICE가 아니면 400
  private parseStatus(
    status: string | undefined,
    allowEmpty: boolean,
  ): RoomUnitStatus | null {
    if (!status && allowEmpty) {
      return null;
    }
    if (
      status !== RoomUnitStatus.ACTIVE &&
      status !== RoomUnitStatus.OUT_OF_SERVICE
    ) {
      throw apiRpcException({
        status: 400,
        code: 'INVALID_ROOM_UNIT_STATUS',
        message: '호실 상태는 ACTIVE 또는 OUT_OF_SERVICE입니다.',
        retryable: false,
      });
    }
    return status;
  }

  private normalizeRoomNumber(roomNumber: string): string {
    const value = (roomNumber ?? '').trim();
    if (!value || value.length > 20) {
      throw apiRpcException({
        status: 400,
        code: 'INVALID_ROOM_NUMBER',
        message: '방 번호는 1~20자로 입력해 주세요.',
        retryable: false,
      });
    }
    return value;
  }

  private duplicateRoomNumber(error: unknown, roomNumber: string): unknown {
    if (isDuplicateKeyError(error)) {
      return apiRpcException({
        status: 409,
        code: 'ROOM_NUMBER_DUPLICATED',
        message: `이 지점에 이미 ${roomNumber}호가 있습니다.`,
        retryable: false,
      });
    }
    return error;
  }

  private notFound(code: string, message: string) {
    return apiRpcException({ status: 404, code, message, retryable: false });
  }
}
