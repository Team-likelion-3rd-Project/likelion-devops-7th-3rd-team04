import { tracingChannel } from 'node:diagnostics_channel';
import { createPool, Pool } from 'mysql2';
import type { DataSource } from 'typeorm';
import { dbPoolStats, trackDbPoolMetrics } from './db-metrics';
import { AppMetrics, startMetrics } from './metrics';

// LDP-182: DB 커넥션 풀 측정. 실제 mysql2 풀을 써서 내부 필드 이름이 바뀌면(버전 업) 여기서 먼저 깨지게 한다
const fakeDataSource = (pool: unknown) =>
  ({ driver: { pool } }) as unknown as DataSource;

// 연결이 거부되는 주소 — DB 없이 연결 시도·실패를 만든다
const unreachablePool = (connectionLimit: number) =>
  createPool({ host: '127.0.0.1', port: 1, connectionLimit });

describe('dbPoolStats', () => {
  let pool: Pool;
  afterEach(() => pool?.end());

  it('mysql2 풀에서 사용 중·쉬는 중·최대·대기 수를 읽는다', () => {
    pool = unreachablePool(3);
    expect(dbPoolStats(pool)).toEqual({
      used: 0,
      idle: 0,
      max: 3,
      pending: 0,
    });
  });

  it('풀이 없거나 모양이 다르면 null', () => {
    expect(dbPoolStats(undefined)).toBeNull();
    expect(dbPoolStats({})).toBeNull();
  });
});

describe('trackDbPoolMetrics', () => {
  let metrics: AppMetrics;
  let pool: Pool;

  afterAll(() => {
    pool?.end();
    metrics?.server.close();
  });

  it('METRICS_PORT가 없어 메트릭이 꺼져 있으면 아무것도 하지 않는다', () => {
    trackDbPoolMetrics(fakeDataSource(unreachablePool(1)));
    expect(tracingChannel('mysql2:pool:connect').hasSubscribers).toBe(false);
  });

  it('풀 상태와 연결을 기다린 시간을 기록한다', async () => {
    metrics = startMetrics('hotel-service', 19481)!;
    pool = unreachablePool(5);
    trackDbPoolMetrics(fakeDataSource(pool));

    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'db_client_connections{state="used",service="hotel-service"} 0',
    );
    expect(text).toContain(
      'db_client_connections{state="idle",service="hotel-service"} 0',
    );
    expect(text).toContain(
      'db_client_connections_max{service="hotel-service"} 5',
    );
    expect(text).toContain(
      'db_client_connections_pending{service="hotel-service"} 0',
    );

    // 연결 요청 1번 (거부되어 실패) → 기다린 시간 1건
    await new Promise<void>((resolve) => pool.getConnection(() => resolve()));
    expect(await metrics.registry.metrics()).toContain(
      'db_client_connection_wait_duration_seconds_count{service="hotel-service"} 1',
    );
  });
});
