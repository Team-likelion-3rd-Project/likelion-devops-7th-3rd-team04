import { status as GrpcStatus } from '@grpc/grpc-js';
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Hotel } from './entities/hotel.entity';
import { rpcError } from '@app/common';

// proto의 Hotel 메시지와 1:1 대응되는 응답 형태
export interface HotelGrpcResponse {
  hotelId: number;
  name: string;
  address: string;
  phoneNumber: string;
  description: string;
}

@Injectable()
export class HotelServiceService implements OnModuleInit {
  private readonly logger = new Logger(HotelServiceService.name);

  // TypeORM의 DataSource를 주입받음
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Hotel)
    private readonly hotelRepository: Repository<Hotel>,
  ) {}

  // 서비스 모듈이 로드될 때 DB 연결 상태 자동 점검
  async onModuleInit() {
    try {
      if (this.dataSource.isInitialized) {
        this.logger.log('✅ MariaDB 데이터베이스 연결 성공!');
      } else {
        this.logger.error('❌ MariaDB 데이터베이스가 초기화되지 않았습니다.');
      }
    } catch (error) {
      this.logger.error('❌ MariaDB 데이터베이스 연결 오류:', error);
    }
  }

  getHello(): string {
    return 'Hotel Hello World!';
  }

  async testConnection(): Promise<string> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();

    try {
      // MariaDB 버전 조회 쿼리 실행
      const result = await queryRunner.query('SELECT VERSION() AS version');
      return `DB Connection OK! MariaDB Version: ${result[0].version}`;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return `DB Connection Failed: ${errorMessage}`;
    } finally {
      await queryRunner.release();
    }
  }

  // 전체 호텔 목록 조회
  async getHotels(): Promise<HotelGrpcResponse[]> {
    const hotels = await this.hotelRepository.find();
    return hotels.map((hotel) => this.toGrpcResponse(hotel));
  }

  // 단건 호텔 조회. 존재하지 않으면 RpcException.
  async getHotel(id: number): Promise<HotelGrpcResponse> {
    const hotel = await this.hotelRepository.findOne({
      where: { hotelId: id },
    });
    if (!hotel) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 호텔입니다.');
    }
    return this.toGrpcResponse(hotel);
  }

  // 기존 호텔 정보 수정. hotelId가 존재하지 않으면 RpcException.
  async updateHotel(
    id: number,
    data: {
      name: string;
      address: string;
      phoneNumber: string;
      description?: string;
    },
  ): Promise<HotelGrpcResponse> {
    const hotel = await this.hotelRepository.findOne({
      where: { hotelId: id },
    });
    if (!hotel) {
      throw rpcError(GrpcStatus.NOT_FOUND, '존재하지 않는 호텔입니다.');
    }

    hotel.name = data.name;
    hotel.address = data.address;
    hotel.phoneNumber = data.phoneNumber;
    hotel.description = data.description;
    const saved = await this.hotelRepository.save(hotel);
    return this.toGrpcResponse(saved);
  }

  private toGrpcResponse(hotel: Hotel): HotelGrpcResponse {
    return {
      hotelId: hotel.hotelId,
      name: hotel.name,
      address: hotel.address,
      phoneNumber: hotel.phoneNumber,
      description: hotel.description ?? '',
    };
  }
}
