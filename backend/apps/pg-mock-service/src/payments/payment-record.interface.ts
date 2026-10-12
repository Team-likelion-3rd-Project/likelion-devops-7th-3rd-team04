export type PaymentStatus = 'READY' | 'DONE' | 'CANCELED';

// 인메모리로만 관리되는 결제 요청 레코드입니다. DB 없이 서버 프로세스 메모리에 두는 이유는
// 목업 서버라 재시작 시 초기화되는 편이 오히려 "매번 깨끗한 상태에서 테스트"에 자연스럽기 때문입니다.
export interface PaymentRecord {
  paymentKey: string;
  orderId: string;
  amount: number;
  orderName: string;
  paymentMethod: string;
  status: PaymentStatus;
  createdAt: string;
  // 실제 PG의 승인번호를 흉내낸 값. paymentKey와 달리 승인(approve) 성공 시점에만 발급됩니다.
  // 결제내역 테이블의 "PG승인번호" 컬럼에 대응합니다.
  approvalNumber?: string;
  approvedAt?: string;
  canceledAt?: string;
  cancelReason?: string;
}
