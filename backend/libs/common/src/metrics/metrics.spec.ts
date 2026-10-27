import express from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { Registry } from 'prom-client';
import {
  AppMetrics,
  httpMetricsMiddleware,
  LATENCY_BUCKETS,
  metricsPortFromEnv,
  startMetrics,
} from './metrics';

// LDP-168: Prometheus 메트릭 1차 (기본 메트릭 + HTTP 요청 측정)
describe('metricsPortFromEnv', () => {
  const before = process.env.METRICS_PORT;
  afterEach(() => {
    process.env.METRICS_PORT = before;
  });

  it('METRICS_PORT가 없거나 숫자가 아니면 null (메트릭 끔)', () => {
    delete process.env.METRICS_PORT;
    expect(metricsPortFromEnv()).toBeNull();
    process.env.METRICS_PORT = '';
    expect(metricsPortFromEnv()).toBeNull();
    process.env.METRICS_PORT = 'abc';
    expect(metricsPortFromEnv()).toBeNull();
  });

  it('숫자면 그 포트', () => {
    process.env.METRICS_PORT = '9464';
    expect(metricsPortFromEnv()).toBe(9464);
  });
});

describe('startMetrics', () => {
  let metrics: AppMetrics | null = null;
  afterEach(() => {
    metrics?.server.close();
    metrics = null;
  });

  it('포트가 없으면 아무것도 띄우지 않는다', () => {
    expect(startMetrics('user-service', null)).toBeNull();
  });

  it('/metrics에 기본 메트릭을 service 라벨과 함께 내보낸다', async () => {
    metrics = startMetrics('user-service', 19464);
    await new Promise((resolve) => metrics!.server.once('listening', resolve));

    const res = await fetch('http://127.0.0.1:19464/metrics');
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain(
      'process_resident_memory_bytes{service="user-service"}',
    );
    expect(body).toContain(
      'nodejs_eventloop_lag_seconds{service="user-service"}',
    );

    const other = await fetch('http://127.0.0.1:19464/other');
    expect(other.status).toBe(404);
  });
});

describe('httpMetricsMiddleware', () => {
  let registry: Registry;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    registry = new Registry();
    const app = express();
    app.use(httpMetricsMiddleware(registry));
    app.get('/api/hotels/:hotelId', (_req, res) => {
      res.json({ ok: true });
    });
    app.post('/api/bookings', (_req, res) => {
      res.status(500).end();
    });
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok' });
    });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => {
    server.close();
  });

  const countLines = async () =>
    (await registry.metrics())
      .split('\n')
      .filter((line) =>
        line.startsWith('http_server_request_duration_seconds_count'),
      );

  // 응답 끝(finish) 이벤트에서 기록하므로 응답을 받은 직후 한 틱 기다린다
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  it('실제 경로가 아닌 라우트 템플릿으로 기록한다', async () => {
    await fetch(`${base}/api/hotels/123`);
    await fetch(`${base}/api/hotels/456`);
    await settle();

    expect(await countLines()).toEqual([
      'http_server_request_duration_seconds_count{http_method="GET",http_route="/api/hotels/:hotelId",http_status_code="200"} 2',
    ]);
  });

  it('상태 코드별로 나누고, 매칭되지 않은 경로는 unmatched', async () => {
    await fetch(`${base}/api/bookings`, { method: 'POST' });
    await fetch(`${base}/no/such/path/42`);
    await settle();

    expect(await countLines()).toEqual(
      expect.arrayContaining([
        'http_server_request_duration_seconds_count{http_method="POST",http_route="/api/bookings",http_status_code="500"} 1',
        'http_server_request_duration_seconds_count{http_method="GET",http_route="unmatched",http_status_code="404"} 1',
      ]),
    );
    expect((await registry.metrics()).includes('/no/such/path')).toBe(false);
  });

  it('/health와 CORS 사전 요청(OPTIONS)은 측정하지 않는다', async () => {
    await fetch(`${base}/health`);
    await fetch(`${base}/api/hotels/1`, { method: 'OPTIONS' });
    await settle();

    expect(await countLines()).toEqual([]);
  });

  it('합의한 공통 버킷을 쓴다', async () => {
    await fetch(`${base}/api/hotels/1`);
    await settle();

    const les = (await registry.metrics())
      .split('\n')
      .filter((line) =>
        line.startsWith('http_server_request_duration_seconds_bucket'),
      )
      .map((line) => /le="([^"]+)"/.exec(line)?.[1]);

    expect(les).toEqual([...LATENCY_BUCKETS.map(String), '+Inf']);
  });
});
