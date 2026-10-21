import { SQSClient } from '@aws-sdk/client-sqs';

// 결제 결과 이벤트 큐 연동 (payment-service 발행 → booking-service 수신).
// 환경변수 이름은 인프라와 확정한 것을 그대로 씁니다 (infra/ansible/README.md 14-6):
//   SQS_ENDPOINT              로컬·온프레미스 dev: ElasticMQ 주소 / AWS prod: 비움 → AWS 기본 주소
//   SQS_REGION                ap-northeast-2 (ElasticMQ) / 실제 리전 (prod)
//   PAYMENT_RESULT_QUEUE_URL  payment-result.fifo 큐 URL (비어 있으면 발행·수신을 하지 않음)
//   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  dev 는 더미, prod 는 넣지 않음 (IAM 역할)
// ElasticMQ 는 SQS 와 같은 API 를 흉내내므로, 코드는 AWS SDK 하나로 두고 주소만 바꿔 끼웁니다.

// NestJS 의존성 주입 토큰 — 테스트에서 가짜 클라이언트로 바꿔 끼우기 위해 씁니다.
export const SQS_CLIENT = 'SQS_CLIENT';

export function createSqsClient(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT || undefined;
  const hasEnvCredentials = Boolean(process.env.AWS_ACCESS_KEY_ID);
  return new SQSClient({
    region: process.env.SQS_REGION || 'ap-northeast-2',
    endpoint,
    // ElasticMQ 는 인증을 검증하지 않지만 AWS SDK 는 자격증명을 요구합니다. 로컬처럼 엔드포인트만 있고
    // 자격증명 환경변수가 없으면 더미값을 넣고, prod(엔드포인트 없음)는 SDK 기본 방식(IAM 역할)을 씁니다.
    credentials:
      endpoint && !hasEnvCredentials
        ? { accessKeyId: 'elasticmq', secretAccessKey: 'elasticmq' }
        : undefined,
  });
}

export function paymentResultQueueUrl(): string {
  return process.env.PAYMENT_RESULT_QUEUE_URL || '';
}

// 결제 결과 이벤트 메시지 본문 (payment_outbox.payload, 위키 API 명세 6.6)
export interface PaymentResultEvent {
  eventId: string;
  eventType:
    | 'PAYMENT_APPROVED'
    | 'PAYMENT_FAILED'
    | 'PAYMENT_REFUNDED'
    | 'PAYMENT_REFUND_FAILED';
  reservationId: number;
  paymentId: number;
  orderId?: string;
  amount: number;
  retryable: boolean;
  occurredAt: string;
}
