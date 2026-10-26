import { errorTrace, redactSqlValues } from './redact';
import { SafeTypeOrmLogger, typeOrmLoggingOptions } from '../db/typeorm-logger';

// LDP-163: 로그에 개인정보(SQL 값)가 남지 않게
describe('redactSqlValues', () => {
  it('DB 오류 문장의 값은 가리고, 키·칼럼 이름은 남긴다', () => {
    expect(
      redactSqlValues(
        "Duplicate entry 'kim@example.com' for key 'users.IDX_email'",
      ),
    ).toBe("Duplicate entry '?' for key 'users.IDX_email'");
    expect(
      redactSqlValues(
        "Incorrect integer value: '010-1234-5678' for column 'user_id' at row 1",
      ),
    ).toBe("Incorrect integer value: '?' for column 'user_id' at row 1");
  });

  it('따옴표 안의 이스케이프된 따옴표까지 한 값으로 가린다', () => {
    expect(redactSqlValues("value 'O\\'Brien' rejected")).toBe(
      "value '?' rejected",
    );
  });
});

describe('errorTrace', () => {
  it('Error는 stack에서 값을 가린다', () => {
    const error = new Error("Duplicate entry 'kim@example.com' for key 'x'");
    const trace = errorTrace(error);

    expect(trace).toContain("Duplicate entry '?' for key 'x'");
    expect(trace).not.toContain('kim@example.com');
  });

  it('gRPC 오류 같은 객체는 details를, 그 밖은 JSON으로', () => {
    expect(errorTrace({ code: 14, details: "no user 'a@b.c'" })).toBe(
      "no user '?'",
    );
    expect(errorTrace({ code: 2 })).toBe('{"code":2}');
    expect(errorTrace('plain')).toBe('plain');
  });
});

describe('SafeTypeOrmLogger', () => {
  const nest = () => (logger: SafeTypeOrmLogger) =>
    (logger as unknown as { logger: Record<string, jest.Mock> }).logger;

  const make = (logQueries: boolean) => {
    const logger = new SafeTypeOrmLogger(logQueries);
    const inner = nest()(logger);
    inner.log = jest.fn();
    inner.warn = jest.fn();
    inner.error = jest.fn();
    return { logger, inner };
  };

  it('실행 쿼리는 DB_LOGGING을 켰을 때만, 값 없이 SQL 문장만', () => {
    const off = make(false);
    off.logger.logQuery('SELECT * FROM users WHERE email = ?');
    expect(off.inner.log).not.toHaveBeenCalled();

    const on = make(true);
    on.logger.logQuery('SELECT * FROM users WHERE email = ?');
    expect(on.inner.log).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE email = ?',
    );
  });

  it('실패한 쿼리는 항상 남기되 값은 가린다 (PARAMETERS를 받지 않음)', () => {
    const { logger, inner } = make(false);

    logger.logQueryError(
      new Error("Duplicate entry 'kim@example.com' for key 'users.IDX_email'"),
      'INSERT INTO users (email) VALUES (?)',
    );

    const [message] = inner.error.mock.calls[0] as [string];
    expect(message).toContain("Duplicate entry '?'");
    expect(message).toContain('INSERT INTO users (email) VALUES (?)');
    expect(message).not.toContain('kim@example.com');
  });

  it('느린 쿼리는 경고 (값 없이)', () => {
    const { logger, inner } = make(false);

    logger.logQuerySlow(1500, 'SELECT 1');

    expect(inner.warn).toHaveBeenCalledWith('느린 쿼리 1500ms — SELECT 1');
  });

  it('설정: 느린 쿼리 기준 기본 1000ms, 환경변수로 변경', () => {
    const before = process.env.DB_SLOW_QUERY_MS;
    delete process.env.DB_SLOW_QUERY_MS;
    expect(typeOrmLoggingOptions().maxQueryExecutionTime).toBe(1000);
    process.env.DB_SLOW_QUERY_MS = '300';
    expect(typeOrmLoggingOptions().maxQueryExecutionTime).toBe(300);
    process.env.DB_SLOW_QUERY_MS = before;
  });
});
