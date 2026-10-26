import { Logger as NestLogger } from '@nestjs/common';
import type { Logger as TypeOrmLogger } from 'typeorm';
import { redactSqlValues } from '../utils/redact';

// 이보다 오래 걸린 쿼리는 경고로 남긴다 (값 없이 SQL 문장만). 부하 테스트에서 느린 쿼리 찾기용
const DEFAULT_SLOW_QUERY_MS = 1000;

// TypeORM 로거 — SQL에 들어간 실제 값(PARAMETERS)은 절대 남기지 않는다 (LDP-163).
// TypeORM 기본 로거(`logging: true`)는 SQL과 값을 함께 찍어서 이메일·이름·전화번호·비밀번호 해시·결제 응답이
// 로그 수집(Fluent Bit → CloudWatch)으로 그대로 나갔다.
//  - 실행 쿼리: DB_LOGGING=true일 때만 SQL 문장만 (로컬 디버깅용, 기본 꺼짐)
//  - 실패한 쿼리: 항상 남기되 SQL 문장 + 오류 원인만, 오류 문장 안의 값은 가림
//  - 느린 쿼리: DB_SLOW_QUERY_MS(기본 1000ms)를 넘으면 경고
export class SafeTypeOrmLogger implements TypeOrmLogger {
  private readonly logger = new NestLogger('TypeORM');

  constructor(
    private readonly logQueries = process.env.DB_LOGGING === 'true',
  ) {}

  logQuery(query: string): void {
    if (this.logQueries) {
      this.logger.log(query);
    }
  }

  logQueryError(error: string | Error, query: string): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.error(`쿼리 실패: ${redactSqlValues(reason)} — ${query}`);
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn(`느린 쿼리 ${time}ms — ${query}`);
  }

  logSchemaBuild(message: string): void {
    if (this.logQueries) {
      this.logger.log(message);
    }
  }

  logMigration(message: string): void {
    this.logger.log(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') {
      this.logger.warn(redactSqlValues(String(message)));
    } else if (this.logQueries) {
      this.logger.log(String(message));
    }
  }
}

// 서비스 DB 설정(TypeOrmModule.forRootAsync)에 펼쳐 넣는다: { ...typeOrmLoggingOptions() }
export function typeOrmLoggingOptions(): {
  logger: SafeTypeOrmLogger;
  maxQueryExecutionTime: number;
} {
  const slow = Number(process.env.DB_SLOW_QUERY_MS);
  return {
    logger: new SafeTypeOrmLogger(),
    maxQueryExecutionTime:
      Number.isInteger(slow) && slow > 0 ? slow : DEFAULT_SLOW_QUERY_MS,
  };
}
