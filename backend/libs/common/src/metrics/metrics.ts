import { Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createServer, Server } from 'node:http';
import { collectDefaultMetrics, Histogram, Registry } from 'prom-client';

// Prometheus 메트릭 (LDP-168). 온프레미스·운영 인프라와 합의한 계약:
//  - METRICS_PORT(9464)의 GET /metrics. env가 없으면 메트릭 서버도, 요청 측정도 하지 않는다
//    → 같은 이미지에서 env만으로 켜고 끈다 (부하 테스트 전후 비교, 문제 시 즉시 끄기)
//  - 앱 공통 라벨은 service(apps 폴더 이름) 하나. namespace·pod·cluster 등은 인프라(ServiceMonitor·Alloy)가 붙인다
//  - 라벨에 ID·이메일·실제 URL·에러 메시지를 넣지 않는다 (개인정보·시계열 폭증)
//  - 지연은 Histogram만, 버킷은 공통 1세트

// 지연 버킷(초). 챗봇 n8n 호출 timeout 30초, 결제 PG timeout 10초를 경계로 넣었다
export const LATENCY_BUCKETS = [0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30];

const logger = new Logger('Metrics');

export interface AppMetrics {
  registry: Registry;
  server: Server;
}

// startMetrics가 만든 레지스트리. gRPC 인터셉터(grpc-metrics.ts)는 모듈 설정 시점(앱 시작 전)에 만들어지므로
// 호출될 때 여기서 레지스트리를 찾는다
let activeRegistry: Registry | null = null;

export function activeMetricsRegistry(): Registry | null {
  return activeRegistry;
}

// METRICS_PORT 값. 없거나 숫자가 아니면 null (= 메트릭 끔)
export function metricsPortFromEnv(): number | null {
  const port = Number(process.env.METRICS_PORT);
  return Number.isInteger(port) && port > 0 ? port : null;
}

// 앱 시작 시 한 번 호출한다. 기본 메트릭(heap·GC·이벤트 루프 등)을 모으고 /metrics 서버를 띄운다.
// Nest 앱과 분리된 Node http 서버라 api-gateway의 CORS·요청 제한(throttler)·Ingress와 무관하다.
export function startMetrics(
  service: string,
  port = metricsPortFromEnv(),
): AppMetrics | null {
  if (!port) {
    return null;
  }

  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });
  activeRegistry = registry;

  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url?.split('?')[0] !== '/metrics') {
      res.statusCode = 404;
      res.end();
      return;
    }
    registry
      .metrics()
      .then((body) => {
        res.setHeader('Content-Type', registry.contentType);
        res.end(body);
      })
      .catch((err: unknown) => {
        logger.error(`메트릭 생성 실패: ${String(err)}`);
        res.statusCode = 500;
        res.end();
      });
  });
  // 메트릭 서버 문제(포트 충돌 등)로 서비스가 죽지 않게 로그만 남긴다
  server.on('error', (err) => {
    logger.error(`메트릭 서버 오류 (port=${port}): ${err.message}`);
  });
  // 메트릭 서버 때문에 프로세스 종료가 늦어지지 않게
  server.unref();
  server.listen(port, '0.0.0.0', () => {
    logger.log(`메트릭 서버 시작 — :${port}/metrics (service=${service})`);
  });

  return { registry, server };
}

// 측정하지 않는 요청: 프로브·수집 요청은 통계를 오염시키고, CORS 사전 요청은 라우트가 없어 unmatched로 몰린다
const EXCLUDED_PATHS = new Set(['/health', '/metrics']);
const KNOWN_METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
]);

// 라우트 템플릿 (/api/hotels/:hotelId). 실제 경로(/api/hotels/123)는 라벨에 넣지 않는다.
// 응답이 끝난 시점에는 라우팅이 끝나 req.route가 있다. 없으면(404) unmatched
export function routeTemplate(req: Request): string {
  const route = req.route as { path?: unknown } | undefined;
  return typeof route?.path === 'string'
    ? `${req.baseUrl ?? ''}${route.path}`
    : 'unmatched';
}

// HTTP 요청 측정 → http_server_request_duration_seconds.
// 미들웨어라 가드에서 막힌 요청(401·429)과 없는 경로(404)까지 센다 (인터셉터는 컨트롤러에 도달한 요청만 본다)
export function httpMetricsMiddleware(registry: Registry): RequestHandler {
  const duration = new Histogram({
    name: 'http_server_request_duration_seconds',
    help: 'HTTP 요청 처리 시간(초)',
    labelNames: ['http_method', 'http_route', 'http_status_code'],
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  });

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'OPTIONS' || EXCLUDED_PATHS.has(req.path)) {
      next();
      return;
    }
    const end = duration.startTimer();
    res.on('finish', () => {
      end({
        http_method: KNOWN_METHODS.has(req.method) ? req.method : 'OTHER',
        http_route: routeTemplate(req),
        http_status_code: String(res.statusCode),
      });
    });
    next();
  };
}
