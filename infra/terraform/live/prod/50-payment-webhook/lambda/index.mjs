// 토스 웹훅 본문(JSON 객체)과 토스 헤더를 큐에 넣고, 전송에 성공한 뒤에만 200 을 응답한다.
// 판단은 하지 않는다. payment-service 소비기가 메시지를 꺼내 저장하고 토스 재조회로 검증한다.
// 전송 실패는 500 으로 응답해 토스 재전송에 맡긴다. 본문에는 결제 정보가 있어 로그에 남기지 않는다.
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

// 토스는 10초 안에 응답을 기다린다. Lambda 제한 시간(8초) 안에 재시도까지 끝나도록 기한을 둔다
const sqs = new SQSClient({
  maxAttempts: 2,
  requestHandler: {
    connectionTimeout: 1_000,
    requestTimeout: 2_000,
    throwOnRequestTimeout: true,
  },
});

const respond = (statusCode) => ({ statusCode, body: '' });

export const handler = async (event) => {
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body ?? '', 'base64').toString('utf8')
    : (event.body ?? '');

  // 소비기가 body.eventType 을 읽으므로 문자열이 아닌 객체로 보낸다
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    console.warn('JSON 이 아닌 웹훅 본문을 거부합니다');
    return respond(400);
  }

  // API Gateway HTTP API(payload 2.0) 는 헤더 이름을 소문자로 넘긴다
  const headers = Object.fromEntries(
    Object.entries(event.headers ?? {}).filter(([name]) =>
      name.startsWith('tosspayments-webhook-'),
    ),
  );

  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.PAYMENT_WEBHOOK_QUEUE_URL,
        MessageBody: JSON.stringify({ headers, body }),
      }),
    );
  } catch (error) {
    console.error(`웹훅 큐 전송 실패: ${error.name}`);
    return respond(500);
  }

  return respond(200);
};
