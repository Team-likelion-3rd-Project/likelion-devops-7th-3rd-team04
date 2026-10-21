// PG(토스 / pg-mock)에 결제 승인을 요청한 결과. PG마다 응답 형식이 달라서, payment-service가
// 쓰는 형태 하나로 맞춘 것입니다.
//
//   APPROVED : 승인 완료 (돈이 움직임)
//   DECLINED : PG가 거절 (카드 거절·잔액 부족 등) — 사용자가 다른 수단으로 다시 시도할 수 있음
//   UNKNOWN  : 타임아웃·네트워크 오류·PG 서버 오류 — 승인됐는지 알 수 없음. 대사 배치가 PG 조회로 확정
export type PgConfirmOutcome = 'APPROVED' | 'DECLINED' | 'UNKNOWN';

export interface PgConfirmResult {
  outcome: PgConfirmOutcome;
  // APPROVED일 때 채워지는 값. paymentKey는 UNKNOWN일 때도 채운다 — 대사 배치가 이 번호로 PG에 조회한다 (LDP-91)
  paymentKey?: string;
  approvalNumber?: string;
  approvedAt?: Date;
  method?: string;
  // DECLINED / UNKNOWN일 때 PG가 준 사유 (로그·raw_response용)
  pgCode?: string;
  pgMessage?: string;
  // PG 응답 원본 — payments.raw_response에 저장 (장애 분석·대사용)
  raw?: Record<string, unknown>;
}
