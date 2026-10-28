import { tracingChannel } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import { Gauge, Histogram } from 'prom-client';
import type { DataSource } from 'typeorm';
import { activeMetricsRegistry, LATENCY_BUCKETS } from './metrics';

// DB 커넥션 풀 측정 (LDP-182). "앱이 본 DB" — DB 서버 상태(CPU·느린 쿼리)는 exporter·CloudWatch 몫이다.
//  - db_client_connections{state="used|idle"}: 지금 빌려 간 연결 / 풀에서 쉬는 연결
//  - db_client_connections_max: 풀 최대 크기 (poolSize, 기본 10)
//  - db_client_connections_pending: 연결이 모두 사용 중이라 줄 서서 기다리는 요청 수
//  - db_client_connection_wait_duration_seconds: 풀에 연결을 요청하고 받기까지 걸린 시간
// 레플리카를 늘리면 (풀 크기 × Pod 수)만큼 DB 연결이 늘어난다 → 풀 크기를 정할 근거로 쓴다.
// 라벨은 공통 service와 state뿐. SQL 문장·테이블 이름은 넣지 않는다.

// mysql2 풀 내부 상태. 공개 API가 없어 내부 필드를 읽는다 (mysql2 3.x lib/base/pool.js).
// 버전이 바뀌어 필드가 없어지면 null → 해당 지표를 비운다 (서비스에는 영향 없음, 테스트가 먼저 깨진다)
interface Mysql2PoolInternals {
  _allConnections?: { length?: unknown };
  _freeConnections?: { length?: unknown };
  _connectionQueue?: { length?: unknown };
  config?: { connectionLimit?: unknown };
}

export interface DbPoolStats {
  used: number;
  idle: number;
  max: number;
  pending: number;
}

export function dbPoolStats(pool: unknown): DbPoolStats | null {
  const p = pool as Mysql2PoolInternals | undefined;
  const all = p?._allConnections?.length;
  const free = p?._freeConnections?.length;
  const pending = p?._connectionQueue?.length;
  const max = p?.config?.connectionLimit;
  if (
    typeof all !== 'number' ||
    typeof free !== 'number' ||
    typeof pending !== 'number' ||
    typeof max !== 'number'
  ) {
    return null;
  }
  return { used: all - free, idle: free, max, pending };
}

// TypeORM mariadb/mysql 드라이버가 만든 mysql2 풀. 연결 전이거나 다른 드라이버면 undefined
function poolOf(dataSource: DataSource): unknown {
  return (dataSource.driver as { pool?: unknown }).pool;
}

// mysql2가 풀에서 연결을 꺼낼 때(getConnection) 알려 주는 진단 채널. 쉬는 연결이 있으면 바로,
// 없으면 새 연결을 맺거나 줄을 선 뒤 콜백이 불린다 → start ~ asyncEnd가 연결을 받기까지 기다린 시간
const POOL_CONNECT_CHANNEL = 'mysql2:pool:connect';
const startedAt = Symbol('dbPoolConnectStartedAt');
type PoolConnectContext = { [startedAt]?: number };

const noop = () => undefined;

// 서비스 시작 후 한 번 호출한다 (main.ts). METRICS_PORT가 없어 메트릭이 꺼져 있으면 아무것도 하지 않는다
export function trackDbPoolMetrics(dataSource: DataSource): void {
  const registry = activeMetricsRegistry();
  if (!registry) {
    return;
  }

  // 아래 Gauge들은 Prometheus가 /metrics를 가져갈 때마다 풀 상태를 읽어 채운다 (평소 비용 없음)
  new Gauge({
    name: 'db_client_connections',
    help: 'DB 커넥션 풀의 연결 수 (used: 사용 중, idle: 쉬는 중)',
    labelNames: ['state'],
    registers: [registry],
    collect() {
      this.reset();
      const stats = dbPoolStats(poolOf(dataSource));
      if (stats) {
        this.set({ state: 'used' }, stats.used);
        this.set({ state: 'idle' }, stats.idle);
      }
    },
  });
  new Gauge({
    name: 'db_client_connections_max',
    help: 'DB 커넥션 풀 최대 크기',
    registers: [registry],
    collect() {
      this.reset();
      const stats = dbPoolStats(poolOf(dataSource));
      if (stats) {
        this.set(stats.max);
      }
    },
  });
  new Gauge({
    name: 'db_client_connections_pending',
    help: '연결이 모두 사용 중이라 DB 커넥션을 기다리는 요청 수',
    registers: [registry],
    collect() {
      this.reset();
      const stats = dbPoolStats(poolOf(dataSource));
      if (stats) {
        this.set(stats.pending);
      }
    },
  });

  const wait = new Histogram({
    name: 'db_client_connection_wait_duration_seconds',
    help: 'DB 커넥션 풀에 연결을 요청하고 받기까지 걸린 시간(초)',
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  });
  // 실패(연결 거부·시간 초과)도 기다린 시간이라 함께 기록한다
  tracingChannel<PoolConnectContext>(POOL_CONNECT_CHANNEL).subscribe({
    start(ctx) {
      ctx[startedAt] = performance.now();
    },
    asyncEnd(ctx) {
      const start = ctx[startedAt];
      if (start !== undefined) {
        wait.observe((performance.now() - start) / 1000);
      }
    },
    end: noop,
    asyncStart: noop,
    error: noop,
  });
}
