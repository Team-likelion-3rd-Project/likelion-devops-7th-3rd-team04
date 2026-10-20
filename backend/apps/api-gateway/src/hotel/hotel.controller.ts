import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
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
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { ApiCommonResponses } from '@app/common/decorators/api-response.decorator';
import { JwtAuthGuard, RolesGuard, Roles } from '@app/common';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateRoomImageUploadUrlDto } from './dto/create-room-image-upload-url.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomAvailabilityQueryDto } from './dto/room-availability-query.dto';
import { RoomSearchQueryDto } from './dto/room-search-query.dto';
import { UpdateHotelDto } from './dto/update-hotel.dto';

// proto의 Hotel 메시지와 1:1 대응되는 응답 형태
interface HotelDto {
  hotelId: number;
  name: string;
  address: string;
  phoneNumber: string;
  description: string;
}

// proto의 RoomImage 메시지와 1:1 대응되는 응답 형태
interface RoomImageDto {
  imageId: number;
  mimeType: string;
  imageUrl: string; // 사진 보기용 Presigned URL (1시간 뒤 만료)
  objectKey: string; // 객실 수정 때 기존 사진을 유지하려면 그대로 다시 보낸다
  sortOrder: number;
}

// proto의 RoomImageUploadUrl 메시지와 1:1 대응되는 응답 형태
interface RoomImageUploadUrlDto {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

// proto의 Room 메시지와 1:1 대응되는 응답 형태
interface RoomDto {
  roomId: number;
  hotelId: number;
  name: string;
  capacity: number;
  totalCount: number; // 객실 타입별 보유 수량 = ACTIVE 호실 수 (같은 날짜에 이 수만큼 예약 가능, LDP-89)
  description: string;
  images: RoomImageDto[];
}

// proto의 RoomSearchResult 메시지와 1:1 대응되는 응답 형태
interface RoomSearchResultDto {
  room: RoomDto;
  minPrice: number;
}

// proto의 RoomAvailabilityDay 메시지와 1:1 대응되는 응답 형태
interface RoomAvailabilityDayDto {
  date: string;
  isAvailable: boolean; // 예약 가능 = 판매 중 && 남은 방 > 0
  price: number;
  remainingCount: number; // 남은 방 수 (0이면 매진)
  isSaleStopped: boolean; // 관리자 판매 중지 여부
}

// proto의 RoomAvailabilityResponse 메시지와 1:1 대응되는 응답 형태
interface RoomAvailabilityDto {
  hotelId: number;
  roomId: number;
  startDate: string;
  endDate: string;
  isAvailable: boolean;
  totalCount: number;
  availabilities: RoomAvailabilityDayDto[];
}

// proto의 HotelService 스펙과 1:1 대응되는 TS 인터페이스
interface HotelService {
  getHello(data: {}): Observable<{ message: string }>;
  getHotels(data: {}): Observable<{ hotels: HotelDto[] }>;
  getHotel(data: { hotelId: number }): Observable<HotelDto>;
  updateHotel(data: {
    hotelId: number;
    name: string;
    address: string;
    phoneNumber: string;
    description?: string;
  }): Observable<HotelDto>;
  getRooms(data: { hotelId: number }): Observable<{ rooms: RoomDto[] }>;
  searchRooms(data: {
    hotelId: number;
    checkIn: string;
    checkOut: string;
    guests: number;
  }): Observable<{ results: RoomSearchResultDto[] }>;
  getRoom(data: { hotelId: number; roomId: number }): Observable<RoomDto>;
  createRoom(data: {
    hotelId: number;
    name: string;
    capacity: number;
    totalCount?: number;
    description?: string;
  }): Observable<RoomDto>;
  updateRoom(data: {
    hotelId: number;
    roomId: number;
    name: string;
    capacity: number;
    totalCount?: number;
    description?: string;
    images?: { objectKey: string }[];
  }): Observable<RoomDto>;
  deleteRoom(data: {
    hotelId: number;
    roomId: number;
  }): Observable<{ success: boolean }>;
  createRoomImageUploadUrl(data: {
    hotelId: number;
    roomId: number;
    mimeType: string;
    size: number;
  }): Observable<RoomImageUploadUrlDto>;
  getRoomAvailability(data: {
    hotelId: number;
    roomId: number;
    startDate: string;
    endDate: string;
  }): Observable<RoomAvailabilityDto>;
}

@ApiTags('HotelService')
@ApiCommonResponses()
@Controller('api/hotels')
export class HotelController implements OnModuleInit {
  private hotelService!: HotelService;

  constructor(@Inject('HOTEL_SERVICE') private readonly client: ClientGrpc) {}

  // NestJS 생명주기: 모듈이 초기화될 때 gRPC 서비스 객체를 추출합니다.
  onModuleInit() {
    this.hotelService = this.client.getService<HotelService>('HotelService');
  }

  /**
   * GET http://localhost:3000/api/hotel/hello
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출
   */
  @Get('hello')
  @ApiOperation({
    summary: '호텔 도메인 서버 헬스체크',
    description:
      'gRPC를 통해 hotel-service 서버의 상태 및 Hello 메시지를 가져옵니다.',
  })
  @ApiResponse({
    status: 200,
    description: 'Hotel Hello World! 출력',
  })
  getHello(): Observable<{ message: string }> {
    return this.hotelService.getHello({});
  }

  /**
   * GET http://localhost:3000/api/hotels
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 전체 호텔 목록 조회
   */
  @Get()
  @ApiOperation({
    summary: '모든 호텔 정보 조회',
    description:
      'gRPC를 통해 hotel-service에서 등록된 모든 호텔 목록을 조회합니다.',
  })
  @ApiResponse({ status: 200, description: '호텔 목록 조회 성공' })
  getHotels(): Observable<{ hotels: HotelDto[] }> {
    return this.hotelService.getHotels({});
  }

  /**
   * GET http://localhost:3000/api/hotels/{hotelId}
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 단건 호텔 조회
   */
  @Get(':hotelId')
  @ApiOperation({
    summary: '특정 호텔 정보 조회',
    description:
      '호텔 PK ID를 바탕으로 gRPC를 통해 hotel-service에서 호텔 상세 정보를 조회합니다.',
  })
  @ApiParam({ name: 'hotelId', description: '호텔 PK ID', example: '1' })
  @ApiResponse({ status: 200, description: '호텔 조회 성공' })
  @ApiResponse({ status: 404, description: '존재하지 않는 호텔' })
  async getHotel(@Param('hotelId') hotelId: string): Promise<HotelDto> {
    return firstValueFrom(
      this.hotelService.getHotel({ hotelId: Number(hotelId) }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 호텔입니다.',
      );
    });
  }

  /**
   * PUT http://localhost:3000/api/hotels/{hotelId}
   * 관리자 전용. 기존 호텔 정보를 수정합니다.
   */
  @Put(':hotelId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '호텔 정보 수정 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 hotel-service의 기존 호텔 정보를 수정합니다.',
  })
  @ApiResponse({ status: 200, description: '호텔 수정 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 호텔' })
  async updateHotel(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Body() dto: UpdateHotelDto,
  ): Promise<HotelDto> {
    return firstValueFrom(
      this.hotelService.updateHotel({ hotelId, ...dto }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 호텔입니다.',
      );
    });
  }

  /**
   * GET http://localhost:3000/api/hotels/{hotelId}/rooms
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 특정 호텔의 전체 객실 목록 조회
   */
  @Get(':hotelId/rooms')
  @ApiOperation({
    summary: '특정 호텔의 전체 객실 조회',
    description:
      '호텔 PK ID를 바탕으로 gRPC를 통해 hotel-service에서 해당 호텔에 등록된 모든 객실 목록을 조회합니다.',
  })
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({ status: 200, description: '객실 목록 조회 성공' })
  @ApiResponse({ status: 404, description: '존재하지 않는 호텔' })
  async getRooms(
    @Param('hotelId', ParseIntPipe) hotelId: number,
  ): Promise<{ rooms: RoomDto[] }> {
    return firstValueFrom(this.hotelService.getRooms({ hotelId })).catch(
      (err) => {
        throw new NotFoundException(
          err?.details || err?.message || '존재하지 않는 호텔입니다.',
        );
      },
    );
  }

  /**
   * GET http://localhost:3000/api/hotels/{hotelId}/rooms/search?checkIn=2026-09-01&checkOut=2026-09-03&guests=2
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 체크인/체크아웃/인원수 조건으로 예약 가능한 객실 검색
   *
   * ⚠️ ':hotelId/rooms/:roomId'보다 먼저 등록해야 한다 — 그렇지 않으면 'search'가 roomId 경로
   * 파라미터로 매칭되어 버린다.
   */
  @Get(':hotelId/rooms/search')
  @ApiOperation({
    summary: '예약 가능 객실 검색',
    description:
      '호텔 PK ID와 체크인/체크아웃 날짜, 인원수를 바탕으로 gRPC를 통해 hotel-service에서 최대 인원(capacity)이 ' +
      'guests 이상이고 지정 기간(checkIn~체크아웃 전날) 동안 예약 가능한 객실 목록을, 구간 중 최저 1박 요금(minPrice)과 ' +
      '함께 조회합니다.',
  })
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({ status: 200, description: '예약 가능 객실 검색 성공' })
  @ApiResponse({
    status: 400,
    description: 'checkOut이 checkIn보다 빠르거나 같음',
  })
  @ApiResponse({ status: 404, description: '존재하지 않는 호텔' })
  async searchRooms(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Query() query: RoomSearchQueryDto,
  ): Promise<{ results: RoomSearchResultDto[] }> {
    if (query.checkIn >= query.checkOut) {
      throw new BadRequestException('checkOut은 checkIn보다 이후여야 합니다.');
    }
    return firstValueFrom(
      this.hotelService.searchRooms({ hotelId, ...query }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 호텔입니다.',
      );
    });
  }

  /**
   * GET http://localhost:3000/api/hotels/{hotelId}/rooms/{roomId}
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 단건 객실 조회
   */
  @Get(':hotelId/rooms/:roomId')
  @ApiOperation({
    summary: '특정 객실 조회',
    description:
      '호텔 PK ID와 객실 PK ID를 바탕으로 gRPC를 통해 hotel-service에서 객실 상세 정보를 조회합니다.',
  })
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiParam({
    name: 'roomId',
    description: '객실 PK ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({ status: 200, description: '객실 조회 성공' })
  @ApiResponse({ status: 404, description: '존재하지 않는 객실' })
  async getRoom(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ): Promise<RoomDto> {
    return firstValueFrom(this.hotelService.getRoom({ hotelId, roomId })).catch(
      (err) => {
        throw new NotFoundException(
          err?.details || err?.message || '존재하지 않는 객실입니다.',
        );
      },
    );
  }

  /**
   * GET http://localhost:3000/api/hotels/{hotelId}/rooms/{roomId}/availability
   * 브라우저/프론트엔드 HTTP 요청 수신 -> hotel-service gRPC 호출 -> 특정 기간 예약 가능 여부 조회
   */
  @Get(':hotelId/rooms/:roomId/availability')
  @ApiOperation({
    summary: '객실 예약 가능 여부 조회',
    description:
      '호텔 PK ID, 객실 PK ID와 조회 기간(startDate~endDate, 둘 다 포함)을 바탕으로 gRPC를 통해 hotel-service에서 날짜별 예약 가능 여부와 가격을 조회합니다. ' +
      '날짜별로 남은 방 수(remainingCount)와 관리자 판매 중지 여부(isSaleStopped)를 따로 내려 주므로 "매진"과 "판매 중지"를 구분할 수 있습니다.',
  })
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiParam({
    name: 'roomId',
    description: '객실 PK ID',
    type: Number,
    example: 1,
  })
  @ApiResponse({ status: 200, description: '예약 가능 여부 조회 성공' })
  @ApiResponse({ status: 404, description: '존재하지 않는 객실' })
  async getRoomAvailability(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Query() query: RoomAvailabilityQueryDto,
  ): Promise<RoomAvailabilityDto> {
    if (query.startDate > query.endDate) {
      throw new BadRequestException(
        'endDate는 startDate보다 빠를 수 없습니다.',
      );
    }
    return firstValueFrom(
      this.hotelService.getRoomAvailability({ hotelId, roomId, ...query }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 객실입니다.',
      );
    });
  }

  /**
   * POST http://localhost:3000/api/hotels/{hotelId}/rooms
   * 관리자 전용. 특정 호텔에 신규 객실을 등록합니다.
   */
  @Post(':hotelId/rooms')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '신규 객실 등록 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 hotel-service에 신규 객실 정보를 등록합니다. ' +
      '사진은 저장 경로에 객실 id가 들어가서, 등록 후 응답의 roomId로 업로드 URL을 받아 올리고 객실 수정(images)으로 붙입니다.',
  })
  @ApiResponse({ status: 201, description: '객실 등록 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 호텔' })
  async createRoom(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomDto> {
    return firstValueFrom(
      this.hotelService.createRoom({ hotelId, ...dto }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 호텔입니다.',
      );
    });
  }

  /**
   * POST http://localhost:3000/api/hotels/{hotelId}/rooms/{roomId}/images/upload-url
   * 관리자 전용. 객실 사진을 저장소(MinIO·S3)에 직접 올릴 Presigned URL을 발급합니다 (LDP-88).
   */
  @Post(':hotelId/rooms/:roomId/images/upload-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiParam({
    name: 'roomId',
    description: '객실(객실 종류) PK ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '객실 사진 업로드 URL 발급 (관리자 전용)',
    description:
      '사진 파일은 이 API로 받은 uploadUrl에 브라우저가 직접 PUT합니다(Content-Type·크기는 요청한 값과 같아야 함, 5분 뒤 만료). ' +
      '업로드가 끝나면 objectKey를 객실 수정의 images[].objectKey로 보냅니다(경로 room-types/{roomId}/...). 저장소 버킷은 비공개라 사진 보기는 ' +
      '객실 조회 응답의 images[].imageUrl(Presigned URL)을 씁니다.',
  })
  @ApiResponse({ status: 201, description: '업로드 URL 발급 성공' })
  @ApiResponse({
    status: 400,
    description: 'JPG·PNG·WEBP가 아니거나 5MB 초과',
  })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 객실' })
  async createRoomImageUploadUrl(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: CreateRoomImageUploadUrlDto,
  ): Promise<RoomImageUploadUrlDto> {
    return firstValueFrom(
      this.hotelService.createRoomImageUploadUrl({ hotelId, roomId, ...dto }),
    ).catch((err: { details?: string; message?: string }) => {
      const message = err?.details || err?.message || '';
      if (message.includes('존재하지 않는 객실')) {
        throw new NotFoundException(message);
      }
      throw new BadRequestException(
        message || '업로드 URL을 발급하지 못했습니다.',
      );
    });
  }

  /**
   * PUT http://localhost:3000/api/hotels/{hotelId}/rooms/{roomId}
   * 관리자 전용. 기존 객실 정보를 수정합니다.
   */
  @Put(':hotelId/rooms/:roomId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiParam({
    name: 'roomId',
    description: '객실 PK ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '객실 정보 수정 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 hotel-service의 기존 객실 정보를 수정합니다. ' +
      'images는 항상 전체 교체됩니다 — 기존 이미지를 유지하려면 요청 바디에 기존 이미지를 그대로 포함해서 함께 보내야 합니다.',
  })
  @ApiResponse({ status: 200, description: '객실 수정 성공' })
  @ApiResponse({
    status: 400,
    description: '사진 경로가 이 객실 것이 아니거나 업로드되지 않음',
  })
  @ApiResponse({
    status: 409,
    description: '보유 수량을 이미 받은 예약 수보다 적게 줄임',
  })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 객실' })
  async updateRoom(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomDto> {
    return firstValueFrom(
      this.hotelService.updateRoom({ hotelId, roomId, ...dto }),
    ).catch((err: { details?: string; message?: string }) => {
      const message = err?.details || err?.message || '';
      if (!message || message.includes('존재하지 않는')) {
        throw new NotFoundException(message || '존재하지 않는 객실입니다.');
      }
      // 보유 수량을 줄이면 이미 받은 예약과 부딪히는 경우 → 409
      if (message.includes('이미 예약된 수')) {
        throw new ConflictException(message);
      }
      // 사진 경로가 잘못됐거나 업로드되지 않은 경우 → 요청 값 문제라 400
      throw new BadRequestException(message);
    });
  }

  /**
   * DELETE http://localhost:3000/api/hotels/{hotelId}/rooms/{roomId}
   * 관리자 전용. 특정 객실을 삭제합니다(연관된 객실 이미지/예약 가능일도 함께 삭제).
   */
  @Delete(':hotelId/rooms/:roomId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  @ApiBearerAuth()
  @ApiParam({
    name: 'hotelId',
    description: '호텔 PK ID',
    type: Number,
    example: 1,
  })
  @ApiParam({
    name: 'roomId',
    description: '객실 PK ID',
    type: Number,
    example: 1,
  })
  @ApiOperation({
    summary: '객실 삭제 (관리자 전용)',
    description:
      '관리자 권한을 가진 사용자만 호출할 수 있습니다. gRPC를 통해 hotel-service의 객실과 연관된 ' +
      '이미지·예약 가능일 정보를 함께 삭제합니다.',
  })
  @ApiResponse({ status: 200, description: '객실 삭제 성공' })
  @ApiResponse({ status: 403, description: '관리자 권한이 없음' })
  @ApiResponse({ status: 404, description: '존재하지 않는 객실' })
  async deleteRoom(
    @Param('hotelId', ParseIntPipe) hotelId: number,
    @Param('roomId', ParseIntPipe) roomId: number,
  ): Promise<{ message: string }> {
    await firstValueFrom(
      this.hotelService.deleteRoom({ hotelId, roomId }),
    ).catch((err) => {
      throw new NotFoundException(
        err?.details || err?.message || '존재하지 않는 객실입니다.',
      );
    });
    return { message: '객실이 삭제되었습니다.' };
  }
}
