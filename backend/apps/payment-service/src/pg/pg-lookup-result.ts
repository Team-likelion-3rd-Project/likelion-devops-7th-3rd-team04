// PG(토스 / pg-mock)에 결제 상태를 조회한 결과 (LDP-91). PG마다 상태 이름이 달라서 하나로 맞춘 것입니다.
// 대사 배치(LDP-97)가 결과를 모르는 결제(UNKNOWN)를 확정하거나, 승인 응답이 애매할 때(이미 처리된 결제)
// 실제 상태를 확인하는 데 씁니다. 조회는 결제 번호(paymentKey)로 합니다 — 토스 문서용 테스트 키는 주문번호 조회가 막혀 있음.
//
//   APPROVED  : 승인 완료 (토스 DONE, pg-mock DONE)
//   CANCELED  : 취소됨 (토스 CANCELED·PARTIAL_CANCELED, pg-mock CANCELED)
//   FAILED    : 승인되지 않고 끝남 (토스 ABORTED·EXPIRED) — 돈이 안 움직였음이 확실
//   PENDING   : 아직 끝나지 않음 (토스 READY·IN_PROGRESS·WAITING_FOR_DEPOSIT, pg-mock READY) — 나중에 다시 조회
//   NOT_FOUND : PG에 그 결제가 없음 (승인 요청이 PG에 닿지 않은 경우 등)
//   UNKNOWN   : 조회 자체가 실패 (타임아웃·PG 서버 오류·설정 오류) — 나중에 다시 조회
export type PgLookupOutcome =
  'APPROVED' | 'CANCELED' | 'FAILED' | 'PENDING' | 'NOT_FOUND' | 'UNKNOWN';

export interface PgLookupResult {
  outcome: PgLookupOutcome;
  pgStatus?: string; // PG가 준 상태 원문 (토스 DONE 등)
  // APPROVED일 때 채워지는 값 (승인 반영에 그대로 쓸 수 있게 PgConfirmResult와 같은 이름)
  paymentKey?: string;
  approvalNumber?: string;
  approvedAt?: Date;
  method?: string;
  pgCode?: string;
  pgMessage?: string;
  raw?: Record<string, unknown>;
}
