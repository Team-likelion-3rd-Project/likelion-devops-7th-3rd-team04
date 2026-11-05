// 토스 웹훅 수신기 (dev). prod 의 API Gateway(HTTP API, payload 2.0) 역할만 하고 판단은 Lambda 코드에 맡긴다.
// index.mjs 는 infra/terraform/live/prod/50-payment-webhook/lambda/index.mjs 를 Ansible 이 그대로 복사한 것 (수정하지 않음).
// 큐 주소는 AWS_ENDPOINT_URL_SQS(같은 노드의 ElasticMQ)로 바꿔 끼운다. 본문에는 결제 정보가 있어 로그에 남기지 않는다.
import { createServer } from 'node:http';
import { handler } from './index.mjs';

const PORT = Number(process.env.PORT ?? 3110);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH ?? '/webhook/toss';
// prod API Gateway 스로틀링 · Lambda 제한 시간과 같은 값 (group_vars/payment.yml)
const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 20);
const BURST_LIMIT = Number(process.env.BURST_LIMIT ?? 40);
const HANDLER_TIMEOUT_MS = Number(process.env.HANDLER_TIMEOUT_MS ?? 8000);
const MAX_BODY_BYTES = 1024 * 1024;

// API Gateway 처럼 텍스트 본문은 그대로, 그 밖의 본문은 base64 로 넘긴다 (index.mjs 가 둘 다 처리)
const TEXT_CONTENT_TYPE = /^(text\/|application\/(json|xml|x-www-form-urlencoded)|[^;]*\+json)/i;

// 토큰 버킷 (API Gateway 스로틀링과 같은 방식). 넘으면 429 → 토스가 재전송한다
let tokens = BURST_LIMIT;
let refilledAt = Date.now();

function takeToken() {
  const now = Date.now();
  tokens = Math.min(BURST_LIMIT, tokens + ((now - refilledAt) / 1000) * RATE_LIMIT);
  refilledAt = now;
  if (tokens < 1) {
    return false;
  }
  tokens -= 1;
  return true;
}

function send(res, statusCode, body = '', headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

// API Gateway 기본 오류 응답과 같은 모양
function sendMessage(res, statusCode, message) {
  send(res, statusCode, JSON.stringify({ message }), { 'content-type': 'application/json' });
}

// 크기를 넘으면 null (더 받지 않고 버린다)
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(size > MAX_BODY_BYTES ? null : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function toEvent(req, path, query, raw) {
  // Node 는 헤더 이름을 이미 소문자로 준다. 같은 이름이 여러 개면 API Gateway 처럼 쉼표로 잇는다
  const headers = Object.fromEntries(
    Object.entries(req.headers).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.join(',') : value,
    ]),
  );
  const isText = TEXT_CONTENT_TYPE.test(headers['content-type'] ?? '');
  return {
    version: '2.0',
    routeKey: `POST ${WEBHOOK_PATH}`,
    rawPath: WEBHOOK_PATH,
    rawQueryString: query,
    headers,
    requestContext: {
      http: {
        method: 'POST',
        path: WEBHOOK_PATH,
        protocol: `HTTP/${req.httpVersion}`,
        sourceIp: headers['x-forwarded-for']?.split(',')[0].trim() ?? req.socket.remoteAddress,
        userAgent: headers['user-agent'] ?? '',
      },
      timeEpoch: Date.now(),
    },
    body: isText ? raw.toString('utf8') : raw.toString('base64'),
    isBase64Encoded: !isText,
  };
}

// Lambda 제한 시간을 넘기면 API Gateway 처럼 500
function invoke(event) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('handler timeout')), HANDLER_TIMEOUT_MS);
  });
  return Promise.race([handler(event), timeout]).finally(() => clearTimeout(timer));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'GET' && path === '/healthz') {
    send(res, 200);
    return;
  }

  // Funnel 은 이 경로 하나만 넘긴다. Funnel 이 경로 앞부분을 떼고 넘기면 '/' 로 오므로 둘 다 받는다
  if (req.method !== 'POST' || (path !== WEBHOOK_PATH && path !== '/')) {
    sendMessage(res, 404, 'Not Found');
    return;
  }

  if (!takeToken()) {
    sendMessage(res, 429, 'Too Many Requests');
    return;
  }

  try {
    const raw = await readBody(req);
    if (raw === null) {
      sendMessage(res, 413, 'Request Entity Too Large');
      return;
    }
    const result = await invoke(toEvent(req, path, url.search.slice(1), raw));
    send(res, result?.statusCode ?? 200, result?.body ?? '', result?.headers ?? {});
  } catch (error) {
    console.error(`웹훅 처리 실패: ${error?.message ?? error}`);
    sendMessage(res, 500, 'Internal Server Error');
  }
});

// 수신기는 루프백에만 연다. 외부 입구는 Tailscale Funnel
server.listen(PORT, '127.0.0.1', () => {
  console.log(`토스 웹훅 수신기 시작: 127.0.0.1:${PORT}${WEBHOOK_PATH}`);
});

// 받은 요청은 끝내고 내려간다 (토스는 10초 안에 응답이 없으면 재전송)
function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), HANDLER_TIMEOUT_MS + 1000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
