import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

// 도메인 로직이 없는 헬스체크 전용 서비스입니다. 고객/관리자 도메인 로직은 각각
// ./user/user.service.ts, ./admin/admin.service.ts를 참고하세요.
@Injectable()
export class UserServiceService implements OnModuleInit {
  private readonly logger = new Logger(UserServiceService.name);

  constructor(private readonly dataSource: DataSource) {}

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
    return 'User Hello World!';
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
}
