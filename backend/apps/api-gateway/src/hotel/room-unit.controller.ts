import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  OnModuleInit,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClientGrpc } from '@nestjs/microservices';
import { Observable, firstValueFrom } from 'rxjs';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import {
  AdminRoles,
  JwtAuthGuard,
  RolesGuard,
  Roles,
  parseApiRpcError,
  toHttpException,
} from '@app/common';
import {
  CreateRoomUnitDto,
  RoomUnitListQueryDto,
  SetRoomUnitStatusDto,
  UnitAssignmentQueryDto,
  UpdateRoomUnitDto,
} from './dto/room-unit.dto';

// proto(hotel.proto)의 RoomUnit 메시지와 1:1 대응
interface RoomUnitDto {
  roomUnitId: number;
  roomId: number; // 객실 종류 ID
  roomName: string;
  hotelId: number;
  roomNumber: string;
  floor: number | null; // 없으면 null (gRPC에서는 0)
  status: string;
}

// proto(booking.proto)의 UnitAssignment 메시지와 1:1 대응
interface UnitAssignmentGrpc {
  reservationId: number;
  roomId: number;
  roomUnitId: number; // 배정 전 0
  checkInDate: string;
  checkOutDate: string;
  status: string;
  userId: number;
}

// 배정 현황 응답의 예약 한 건 (API 명세 / LDP-89 이슈 7번)
interface AssignmentDto {
  reservationId: number;
  checkInDate: string;
  checkOutDate: string;
  reservationStatus: string;
  userId: number;
  guestName: string;
}

interface UnitAssignmentsDto {
  hotelId: number;
  startDate: string;
  endDate: string;
  units: (RoomUnitDto & { assignments: AssignmentDto[] })[];
  unassigned: (AssignmentDto & { roomId: number })[];
}

interface HotelRoomUnitService {
  listRoomUnits(data: {
    hotelId: number;
    roomId: number;
    status: string;
  }): Observable<{ units?: RoomUnitDto[] }>;
  getRoomUnitsByIds(data: {
    roomUnitIds: number[];
  }): Observable<{ units?: RoomUnitDto[] }>;
  createRoomUnit(data: {
    hotelId: number;
    roomId: number;
    roomNumber: string;
    floor: number;
  }): Observable<RoomUnitDto>;
  updateRoomUnit(data: {
    hotelId: number;
    roomUnitId: number;
    roomNumber: string;
    floor: number;
  }): Observable<RoomUnitDto>;
  setRoomUnitStatus(data: {
    hotelId: number;
    roomUnitId: number;
    status: string;
  }): Observable<RoomUnitDto>;
}

interface BookingAssignmentService {
  listUnitAssignments(data: {
    hotelId: number;
    startDate: string;
    endDate: string;
    roomId: number;
  }): Observable<{ assignments?: UnitAssignmentGrpc[] }>;
  countFutureUnitAssignments(data: {
    roomUnitId: number;
  }): Observable<{ count: number }>;
}

interface UserLookupService {
  getUserById(data: { id: number }): Observable<{ id: number; name: string }>;
}

// 배정 현황 조회 기간 최대 일수 (시작일·종료일 포함)
const MAX_ASSIGNMENT_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

// 하위 서비스가 api-error 형식으로 던진 에러는 그대로 옮기고({ statusCode, error, code, message, retryable },
// API 명세 5.10), 그 밖의 에러(서비스 연결 실패 등)는 503으로 바꾼다.
function toHttpError(err: unknown, code: string, message: string): Error {
  const payload = parseApiRpcError(err);
  if (payload) {
    return toHttpException(payload);
  }
  return toHttpException({ status: 503, code, message, retryable: true });
}

function badRequest(code: string, message: string): HttpException {
  return toHttpException({ status: 400, code, message, retryable: false });
}

// gRPC는 "없음"을 0으로 보내므로, 응답에서는 null로 바꿔 준다.
function toRoomUnit(unit: RoomUnitDto): RoomUnitDto {
  return { ...unit, floor: unit.floor || null };
}

// 호실 관리 API (LDP-89). 호실 = 실제 방 한 칸(201호 등), 객실 종류(roomId) 아래에 속한다.
// 예약은 객실 종류의 재고만 잡고, 호실은 직원이 나중에 배정한다 (배정 API는 PUT /api/bookings/:id/room-unit).
// 호실 정보는 hotel-service, 배정 정보는 booking-service에 있어 두 서비스가 서로를 부르지 않도록
// 둘을 함께 써야 하는 확인·조합(점검 전 배정 확인, 배정 현황)은 여기서 한다.
@ApiTags('RoomUnit')
@ApiCommonResponses()
@Controller('api/hotels')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
export class RoomUnitController implements OnModuleInit {
  private hotelService!: HotelRoomUnitService;
  private bookingService!: BookingAssignmentService;
  private userService!: UserLookupService;

  constructor(
    @Inject('HOTEL_SERVICE') private readonly hotelClient: ClientGrpc,
    @Inject('BOOKING_SERVICE') private readonly bookingClient: ClientGrpc,
    @Inject('USER_SERVICE') private readonly userClient: ClientGrpc,
  ) {}

  onModuleInit() {
    this.hotelService =
      this.hotelClient.getService<HotelRoomUnitService>('HotelService');
    this.bookingService =
      this.bookingClient.getService<BookingAssignmentService>('BookingService');
    this.userService =
      this.userClient.getService<UserLookupService>('UserService');
  }

  /**
   * GET /api/hotels/{hotelId}/rooms/{roomId}/units
   */
  @Get(':hotelId/rooms/:roomId/units')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiParam({
    name: 'roomId',
    description: '객실 종류 ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '객실 종류별 호실 목록 (관리자 전용)',
    description: '방 번호 순으로 정렬합니다.',
  })
  @ApiResponse({ status: 200, description: '{ units: RoomUnit[] }' })
  @ApiResponse({ status: 404, description: 'HOTEL_NOT_FOUND / ROOM_NOT_FOUND' })
  async listRoomTypeUnits(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ): Promise<{ units: RoomUnitDto[] }> {
    return this.listUnits(hotelId, roomId, '');
  }

  /**
   * GET /api/hotels/{hotelId}/units?status=ACTIVE&roomId=1
   */
  @Get(':hotelId/units')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiOperation({
    summary: '지점 전체 호실 목록 (관리자 전용)',
    description: 'status·roomId로 거를 수 있습니다 (모두 선택).',
  })
  @ApiResponse({ status: 200, description: '{ units: RoomUnit[] }' })
  @ApiResponse({ status: 404, description: 'HOTEL_NOT_FOUND / ROOM_NOT_FOUND' })
  async listHotelUnits(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Query() query: RoomUnitListQueryDto,
  ): Promise<{ units: RoomUnitDto[] }> {
    return this.listUnits(hotelId, query.roomId ?? 0, query.status ?? '');
  }

  /**
   * POST /api/hotels/{hotelId}/rooms/{roomId}/units
   */
  @Post(':hotelId/rooms/:roomId/units')
  @AdminRoles('SUPER', 'MANAGER')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiParam({
    name: 'roomId',
    description: '객실 종류 ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '호실 추가 (관리자 전용)',
    description:
      'ACTIVE로 생성되고, 객실 종류의 보유 수량(totalCount)이 1 늘어납니다.',
  })
  @ApiResponse({ status: 201, description: 'RoomUnit' })
  @ApiResponse({ status: 404, description: 'HOTEL_NOT_FOUND / ROOM_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ROOM_NUMBER_DUPLICATED' })
  async createUnit(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: CreateRoomUnitDto,
  ): Promise<RoomUnitDto> {
    const unit = await firstValueFrom(
      this.hotelService.createRoomUnit({
        hotelId,
        roomId,
        roomNumber: dto.roomNumber,
        floor: dto.floor ?? 0,
      }),
    ).catch((err) => {
      throw this.hotelError(err);
    });
    return toRoomUnit(unit);
  }

  /**
   * PUT /api/hotels/{hotelId}/units/{roomUnitId}
   */
  @Put(':hotelId/units/:roomUnitId')
  @AdminRoles('SUPER', 'MANAGER')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiParam({ name: 'roomUnitId', type: Number, example: 1 })
  @ApiOperation({
    summary: '호실 수정 (관리자 전용)',
    description: '방 번호·층을 바꿉니다. floor를 빼면 층 정보가 지워집니다.',
  })
  @ApiResponse({ status: 200, description: 'RoomUnit' })
  @ApiResponse({ status: 404, description: 'ROOM_UNIT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'ROOM_NUMBER_DUPLICATED' })
  async updateUnit(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomUnitId', ParseIntPipe) roomUnitId: number,
    @Body() dto: UpdateRoomUnitDto,
  ): Promise<RoomUnitDto> {
    const unit = await firstValueFrom(
      this.hotelService.updateRoomUnit({
        hotelId,
        roomUnitId,
        roomNumber: dto.roomNumber,
        floor: dto.floor ?? 0,
      }),
    ).catch((err) => {
      throw this.hotelError(err);
    });
    return toRoomUnit(unit);
  }

  /**
   * PUT /api/hotels/{hotelId}/units/{roomUnitId}/status
   */
  @Put(':hotelId/units/:roomUnitId/status')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiParam({ name: 'roomUnitId', type: Number, example: 1 })
  @ApiOperation({
    summary: '호실 점검 처리·해제 (관리자 전용)',
    description:
      '점검(OUT_OF_SERVICE)이면 보유 수량 −1, 해제(ACTIVE)면 +1. ' +
      '점검하면 오늘 이후 예약 수가 보유 수량을 넘거나, 이 호실에 미래 배정이 있으면 거절합니다.',
  })
  @ApiResponse({ status: 200, description: 'RoomUnit' })
  @ApiResponse({ status: 404, description: 'ROOM_UNIT_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'ROOM_UNIT_HAS_ASSIGNMENTS / ROOM_UNIT_OVERBOOKING',
  })
  async setUnitStatus(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomUnitId', ParseIntPipe) roomUnitId: number,
    @Body() dto: SetRoomUnitStatusDto,
  ): Promise<RoomUnitDto> {
    if (dto.status === 'OUT_OF_SERVICE') {
      // 배정은 booking-service에 있어 hotel-service가 직접 볼 수 없다 → 여기서 먼저 확인한다.
      // (다른 지점 호실이면 배정 수보다 404가 먼저 나가도록 호실부터 확인)
      const unit = await this.findUnit(hotelId, roomUnitId);
      const { count } = await firstValueFrom(
        this.bookingService.countFutureUnitAssignments({ roomUnitId }),
      ).catch((err) => {
        throw toHttpError(
          err,
          'BOOKING_SERVICE_UNAVAILABLE',
          '호실 배정 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      });
      if (count > 0) {
        throw toHttpException({
          status: 409,
          code: 'ROOM_UNIT_HAS_ASSIGNMENTS',
          message: `${unit.roomNumber}호에 앞으로 이용할 예약 ${count}건이 배정돼 있습니다. 먼저 다른 호실로 옮겨 주세요.`,
          retryable: false,
        });
      }
    }
    const unit = await firstValueFrom(
      this.hotelService.setRoomUnitStatus({
        hotelId,
        roomUnitId,
        status: dto.status,
      }),
    ).catch((err) => {
      throw this.hotelError(err);
    });
    return toRoomUnit(unit);
  }

  /**
   * GET /api/hotels/{hotelId}/unit-assignments?startDate=2026-11-01&endDate=2026-11-07&roomId=1
   */
  @Get(':hotelId/unit-assignments')
  @ApiParam({ name: 'hotelId', type: Number, example: 1 })
  @ApiOperation({
    summary: '기간별 호실 배정 현황 (관리자 전용)',
    description:
      '호실마다 기간과 겹치는 배정 예약(assignments)과, 아직 배정 안 된 예약(unassigned)을 돌려줍니다. ' +
      '결제 대기·예약 확정 예약만 포함합니다. 기간은 최대 31일입니다.',
  })
  @ApiResponse({ status: 200, description: '배정 현황' })
  @ApiResponse({ status: 400, description: '날짜 형식 / 기간 31일 초과' })
  @ApiResponse({ status: 404, description: 'HOTEL_NOT_FOUND / ROOM_NOT_FOUND' })
  async getUnitAssignments(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Query() query: UnitAssignmentQueryDto,
  ): Promise<UnitAssignmentsDto> {
    const { startDate, endDate } = query;
    const roomId = query.roomId ?? 0;
    const days =
      (Date.parse(`${endDate}T00:00:00Z`) -
        Date.parse(`${startDate}T00:00:00Z`)) /
        DAY_MS +
      1;
    if (days < 1) {
      throw badRequest(
        'INVALID_DATE_RANGE',
        'endDate는 startDate보다 빠를 수 없습니다.',
      );
    }
    if (days > MAX_ASSIGNMENT_DAYS) {
      throw badRequest(
        'INVALID_DATE_RANGE',
        `조회 기간은 최대 ${MAX_ASSIGNMENT_DAYS}일입니다.`,
      );
    }

    // 호실 목록(호텔·객실 종류 확인 포함)과 배정 예약을 동시에 가져온다
    const [{ units }, { assignments = [] }] = await Promise.all([
      this.listUnits(hotelId, roomId, ''),
      firstValueFrom(
        this.bookingService.listUnitAssignments({
          hotelId,
          startDate,
          endDate,
          roomId,
        }),
      ).catch((err) => {
        throw toHttpError(
          err,
          'BOOKING_SERVICE_UNAVAILABLE',
          '예약 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.',
        );
      }),
    ]);

    const guestNames = await this.findGuestNames(
      assignments.map((a) => a.userId),
    );
    const toAssignment = (a: UnitAssignmentGrpc): AssignmentDto => ({
      reservationId: a.reservationId,
      checkInDate: a.checkInDate,
      checkOutDate: a.checkOutDate,
      reservationStatus: a.status,
      userId: a.userId,
      guestName: guestNames.get(a.userId) ?? '',
    });

    const unitIds = new Set(units.map((u) => u.roomUnitId));
    return {
      hotelId,
      startDate,
      endDate,
      units: units.map((unit) => ({
        ...unit,
        assignments: assignments
          .filter((a) => a.roomUnitId === unit.roomUnitId)
          .map(toAssignment),
      })),
      // 배정 전 예약 + (드물게) 목록에 없는 호실에 배정된 예약도 빠뜨리지 않도록 함께 담는다
      unassigned: assignments
        .filter((a) => !a.roomUnitId || !unitIds.has(a.roomUnitId))
        .map((a) => ({ ...toAssignment(a), roomId: a.roomId })),
    };
  }

  private async listUnits(
    hotelId: number,
    roomId: number,
    status: string,
  ): Promise<{ units: RoomUnitDto[] }> {
    const { units = [] } = await firstValueFrom(
      this.hotelService.listRoomUnits({ hotelId, roomId, status }),
    ).catch((err) => {
      throw this.hotelError(err);
    });
    return { units: units.map(toRoomUnit) };
  }

  // 이 지점의 호실인지 확인 (다른 지점 호실도 404)
  private async findUnit(
    hotelId: number,
    roomUnitId: number,
  ): Promise<RoomUnitDto> {
    const { units = [] } = await firstValueFrom(
      this.hotelService.getRoomUnitsByIds({ roomUnitIds: [roomUnitId] }),
    ).catch((err) => {
      throw this.hotelError(err);
    });
    const unit = units[0];
    if (!unit || unit.hotelId !== hotelId) {
      throw toHttpException({
        status: 404,
        code: 'ROOM_UNIT_NOT_FOUND',
        message: '존재하지 않는 호실입니다.',
        retryable: false,
      });
    }
    return unit;
  }

  // 예약자 이름. 회원 조회가 실패해도 배정 현황은 보여야 하므로 이름만 빈 문자열로 둔다.
  private async findGuestNames(
    userIds: number[],
  ): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    await Promise.all(
      [...new Set(userIds)].map(async (id) => {
        const user = await firstValueFrom(
          this.userService.getUserById({ id }),
        ).catch(() => null);
        if (user) {
          names.set(id, user.name);
        }
      }),
    );
    return names;
  }

  private hotelError(err: unknown): Error {
    return toHttpError(
      err,
      'HOTEL_SERVICE_UNAVAILABLE',
      '호실 정보를 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.',
    );
  }
}
