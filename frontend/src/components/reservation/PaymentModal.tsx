import { useEffect, useState } from 'react'
import { createPayment } from '../../api/payments'
import type { Payment } from '../../api/payments'
import './PaymentModal.css'

export interface PaymentModalSummary {
  /** 상품명 (객실명) */
  roomName: string
  /** 호텔명 — 알 수 없는 경우(조회 실패 등) 생략 가능 */
  hotelName?: string
  /** "2026.08.20 - 2026.08.22 · 2박" 형태로 이미 포맷된 기간 문자열 */
  period?: string
  amount: number
}

interface PaymentModalProps {
  reservationId: number
  summary: PaymentModalSummary
  onClose: () => void
  /** 결제 API가 성공 응답을 준 뒤 호출된다. 호출부가 결제완료 화면 전환/예약 상태 갱신을 책임진다. */
  onPaid: (payment: Payment) => void
}

// 실시간 계좌이체는 별도 후속 작업이 필요해 이번 목업에서는 제외한다.
const PAYMENT_METHODS = [
  { key: 'card', label: '신용·체크카드' },
  { key: 'simple', label: '간편결제' },
] as const

type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]['key']

const SIMPLE_PAY_PROVIDERS = [
  { key: 'kakaopay', label: '카카오페이', paymentMethod: 'KAKAOPAY' },
  { key: 'naverpay', label: '네이버페이', paymentMethod: 'NAVERPAY' },
  { key: 'tosspay', label: '토스페이', paymentMethod: 'TOSSPAY' },
] as const

// 카드번호 입력값을 "0000 0000 0000 0000" 형태로 맞춰 보여준다.
function formatCardNumber(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 16)
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ')
}

// 유효기간 입력값을 "MM/YY" 형태로 맞춰 보여준다.
function formatExpiry(raw: string) {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

/** PG사 연동 없이 프론트에서 직접 구성한 모의 결제창. 카드번호/CVC 등은 화면상 입력만 받을 뿐
 * PG에 실제로 전달되지 않으며, 결제 자체는 payment-service(mock PG)가 내부에서 처리한다.
 * "결제하기"를 누르면 POST /api/payments를 호출하고, 성공하면 onPaid로 결과를 알린다. */
function PaymentModal({ reservationId, summary, onClose, onPaid }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethodKey>('card')
  const [cardNumber, setCardNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [simpleProvider, setSimpleProvider] = useState<(typeof SIMPLE_PAY_PROVIDERS)[number]['key'] | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const paymentMethod =
    method === 'card' ? 'CARD' : SIMPLE_PAY_PROVIDERS.find((p) => p.key === simpleProvider)?.paymentMethod

  const handleConfirm = async () => {
    if (!paymentMethod) {
      setErrorMessage('결제수단을 선택해주세요.')
      return
    }

    setErrorMessage('')
    setIsSubmitting(true)
    try {
      const payment = await createPayment({ reservationId, paymentMethod })
      onPaid(payment)
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '결제에 실패했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    // 결제 정보 입력 중 바깥을 잘못 눌러 닫히는 걸 막기 위해, 오버레이 클릭으로는 닫지 않는다
    // (닫기는 우측 상단 × 버튼 또는 취소 버튼으로만 가능).
    <div className="payment-modal-overlay">
      <div
        className="payment-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-modal-title"
      >
        <button type="button" className="payment-modal-close" onClick={onClose} aria-label="닫기">
          ×
        </button>

        <div className="payment-modal-header">
          <span className="payment-modal-test-badge">TEST</span>
          <h2 id="payment-modal-title" className="payment-modal-title">
            결제하기
          </h2>
        </div>
        <p className="payment-modal-notice">
          실제 PG사와 연동되지 않은 모의 결제창입니다. 결제가 실제로 발생하지 않습니다.
        </p>

        <div className="payment-modal-summary">
          <div className="payment-modal-summary-row">
            <span>예약 상품</span>
            <span>
              {summary.hotelName ? `${summary.hotelName} · ` : ''}
              {summary.roomName}
            </span>
          </div>
          {summary.period && (
            <div className="payment-modal-summary-row">
              <span>이용 기간</span>
              <span>{summary.period}</span>
            </div>
          )}
          <div className="payment-modal-summary-row payment-modal-summary-amount">
            <span>결제 금액</span>
            <strong>{summary.amount.toLocaleString()}원</strong>
          </div>
        </div>

        <div className="payment-modal-section">
          <p className="payment-modal-section-title">결제 수단</p>
          <div className="payment-modal-method-list" role="radiogroup" aria-label="결제 수단 선택">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="radio"
                aria-checked={method === m.key}
                className={`payment-modal-method${method === m.key ? ' is-selected' : ''}`}
                onClick={() => setMethod(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {method === 'card' && (
          <div className="payment-modal-fields">
            <label className="payment-modal-field">
              카드 번호
              <input
                type="text"
                inputMode="numeric"
                placeholder="0000 0000 0000 0000"
                value={cardNumber}
                onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
              />
            </label>
            <div className="payment-modal-fields-row">
              <label className="payment-modal-field">
                유효기간
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="MM/YY"
                  value={expiry}
                  onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                />
              </label>
              <label className="payment-modal-field">
                CVC
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder="•••"
                  maxLength={3}
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, 3))}
                />
              </label>
            </div>
          </div>
        )}

        {method === 'simple' && (
          <div className="payment-modal-simple-list">
            {SIMPLE_PAY_PROVIDERS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`payment-modal-simple-item${simpleProvider === p.key ? ' is-selected' : ''}`}
                onClick={() => setSimpleProvider(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {errorMessage && <p className="payment-modal-error">{errorMessage}</p>}

        <div className="payment-modal-actions">
          <button type="button" className="payment-modal-cancel" onClick={onClose} disabled={isSubmitting}>
            취소
          </button>
          <button type="button" className="payment-modal-confirm" onClick={handleConfirm} disabled={isSubmitting}>
            {isSubmitting ? '결제 처리 중…' : `${summary.amount.toLocaleString()}원 결제하기`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaymentModal
