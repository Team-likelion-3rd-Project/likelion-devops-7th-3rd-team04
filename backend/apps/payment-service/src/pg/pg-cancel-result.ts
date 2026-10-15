// PG(토스 / pg-mock)에 결제 취소(환불)를 요청한 결과. PG마다 응답 형식이 달라서 하나로 맞춘 것입니다.
//
//   CANCELED : 취소 완료 (이미 취소된 결제였던 경우 포함 — 같은 환불이 재시도된 상황)
//   FAILED   : 취소 실패·타임아웃 — 같은 환불 멱등 키로 다시 시도하면 되므로 REFUND_FAILED로 두고
//              대사 배치(또는 다음 취소 요청)가 재시도합니다
export type PgCancelOutcome = 'CANCELED' | 'FAILED';

export interface PgCancelResult {
  outcome: PgCancelOutcome;
  canceledAt?: Date;
  pgCode?: string;
  pgMessage?: string;
  // PG 응답 원본 — payments.raw_response.cancel에 저장 (장애 분석·대사용)
  raw?: Record<string, unknown>;
}
