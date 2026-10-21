import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ANONYMOUS, loadTossPayments, type TossPaymentsWidgets } from '@tosspayments/tosspayments-sdk'
import type { Booking } from '../../api/gateway'
import {
  IS_PAYMENT_FAKE,
  PAYMENT_BLOCK_MESSAGE,
  PAYMENT_MODE,
  PaymentApiError,
  TOSS_CLIENT_KEY,
  fetchLatestBooking,
  paymentBlockReason,
  paymentFailUrl,
  paymentSuccessUrl,
  preparePayment,
} from '../../api/payments'
import { customerAuth } from '../../api/tokenStore'
import './PaymentModal.css'

// 토스 결제위젯이 그려질 자리 (renderPaymentMethods·renderAgreement의 selector)
const TOSS_METHODS_ID = 'toss-payment-methods'
const TOSS_AGREEMENT_ID = 'toss-payment-agreement'

// 모달을 닫았다 바로 다시 열면(React 개발 모드의 effect 두 번 실행 포함) 이전 위젯 제거가 끝나기 전에
// 같은 자리에 다시 그리게 된다. 제거가 끝난 뒤에 그리도록 마지막 제거 작업을 기다린다.
let pendingWidgetCleanup: Promise<unknown> = Promise.resolve()

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
  /** 결제 직전에 다시 조회한 예약 상태가 화면과 달라 결제를 막았을 때, 화면도 최신 상태로 바꾸도록 넘겨준다 */
  onBookingChange?: (booking: Booking) => void
}

/** 결제창. "결제하기"를 누르면 결제 준비(payment-attempts)로 주문번호와 금액을 받은 뒤 결제를 진행한다.
 * - MOCK: 토스 결제창 없이 바로 결과 화면(/reservation/payment/success)으로 이동해 승인을 요청한다.
 * - TOSS: 토스 결제위젯(결제 수단·약관)을 그리고, 결제 준비로 받은 orderId·금액 그대로 토스 결제창을 띄운다 (LDP-119).
 *   토스가 successUrl(결과 화면) / failUrl(실패 화면)로 돌려보내면 그 화면이 승인 요청·안내를 이어서 한다.
 * 결제 결과(승인·실패·확인 중)는 결과 화면이 보여주므로, 이 창은 결과를 따로 받지 않는다.
 * 이중 결제를 막기 위해 결제 준비 직전에 예약을 다시 조회해, 승인 확인 중·결제 기한 만료면 진행하지 않는다. */
function PaymentModal({ reservationId, summary, onClose, onBookingChange }: PaymentModalProps) {
  const navigate = useNavigate()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  // 결제할 수 없는 예약으로 확인되면 같은 창에서 다시 누르지 못하게 막는다
  const [isBlocked, setIsBlocked] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const isToss = PAYMENT_MODE === 'TOSS'
  const orderName = summary.hotelName ? `${summary.hotelName} ${summary.roomName}` : summary.roomName

  // TOSS 모드: 결제위젯을 불러와 결제 수단·약관을 그린다. 다 그려지기 전에는 결제 버튼을 막는다.
  const widgetsRef = useRef<TossPaymentsWidgets | null>(null)
  const [widgetStatus, setWidgetStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    if (!isToss) return
    let cancelled = false
    const rendered: { destroy: () => Promise<void> }[] = []

    const render = async () => {
      try {
        await pendingWidgetCleanup
        if (!TOSS_CLIENT_KEY) throw new Error('토스 클라이언트 키(VITE_TOSS_CLIENT_KEY)가 설정되지 않았습니다.')
        const tossPayments = await loadTossPayments(TOSS_CLIENT_KEY)
        // 구매자 식별값은 유추할 수 있는 회원 번호를 쓰지 말라는 토스 권고에 따라 비회원 결제(ANONYMOUS)로 둔다.
        const widgets = tossPayments.widgets({ customerKey: ANONYMOUS })
        await widgets.setAmount({ currency: 'KRW', value: summary.amount })
        if (cancelled) return
        rendered.push(
          ...(await Promise.all([
            widgets.renderPaymentMethods({ selector: `#${TOSS_METHODS_ID}`, variantKey: 'DEFAULT' }),
            widgets.renderAgreement({ selector: `#${TOSS_AGREEMENT_ID}`, variantKey: 'AGREEMENT' }),
          ])),
        )
        if (cancelled) return
        widgetsRef.current = widgets
        setWidgetStatus('ready')
      } catch (err) {
        if (cancelled) return
        setWidgetStatus('error')
        setErrorMessage(
          `토스 결제창을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.${err instanceof Error ? ` (${err.message})` : ''}`,
        )
      }
    }
    const renderDone = render()

    return () => {
      cancelled = true
      widgetsRef.current = null
      pendingWidgetCleanup = renderDone.then(() => Promise.allSettled(rendered.map((w) => w.destroy())))
    }
  }, [isToss, summary.amount])

  // 결제할 수 없는 예약이면 안내 문구를 보여주고, 화면에도 최신 예약 상태를 반영한다.
  const blockWith = (message: string, latest: Booking | null) => {
    setErrorMessage(message)
    setIsBlocked(true)
    setIsSubmitting(false)
    if (latest) onBookingChange?.(latest)
  }

  const handleConfirm = async () => {
    setErrorMessage('')
    setIsSubmitting(true)

    const latest = await fetchLatestBooking(reservationId)
    const reason = latest ? paymentBlockReason(latest) : null
    if (reason) {
      blockWith(PAYMENT_BLOCK_MESSAGE[reason], latest)
      return
    }

    try {
      const attempt = await preparePayment(reservationId, { amount: summary.amount, orderName })

      if (isToss) {
        const widgets = widgetsRef.current
        if (!widgets) throw new Error('토스 결제창이 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.')
        // 서버가 정한 금액·주문번호 그대로 결제창을 띄운다 (승인 때 서버가 저장된 금액과 비교한다, 명세 5.9).
        if (attempt.amount !== summary.amount) await widgets.setAmount({ currency: 'KRW', value: attempt.amount })
        const user = customerAuth.getUser()
        await widgets.requestPayment({
          orderId: attempt.orderId,
          orderName: attempt.orderName,
          successUrl: paymentSuccessUrl(reservationId),
          failUrl: paymentFailUrl(reservationId),
          customerName: user?.name,
          customerEmail: user?.email,
        })
        // 결제창에서 결제·취소하면 토스가 successUrl·failUrl로 페이지를 옮긴다 (이 아래는 실행되지 않음)
        return
      }

      // MOCK은 토스 결제창이 없으므로, 토스가 성공 URL로 돌려보낼 때와 같은 값을 직접 붙여 결과 화면으로 간다.
      // paymentKey는 토스가 발급하는 값이라 MOCK에서는 mock_{orderId}를 보낸다 (명세 5.9).
      const successUrl = new URL(paymentSuccessUrl(reservationId))
      successUrl.searchParams.set('paymentKey', `mock_${attempt.orderId}`)
      successUrl.searchParams.set('orderId', attempt.orderId)
      successUrl.searchParams.set('amount', String(attempt.amount))
      navigate(`${successUrl.pathname}${successUrl.search}`)
    } catch (err) {
      // 결제 기한 만료·시도 횟수 초과 등은 서버가 code와 안내 문구를 함께 준다 (명세 5.8·5.10).
      // retryable=false면 같은 예약으로 다시 눌러도 결과가 같으므로 버튼을 막고 예약 상태를 다시 불러온다.
      const message = err instanceof Error ? err.message : '결제를 시작하지 못했습니다.'
      // 이전 결제 결과를 서버가 확인 중이면(409 PAYMENT_CONFIRMING, #200) 다시 눌러도 막히므로, 확인 중 안내로 버튼을 막고
      // 예약을 다시 불러온다 (화면이 오래돼 승인 확인 중인 걸 몰랐던 경우).
      if (err instanceof PaymentApiError && err.code === 'PAYMENT_CONFIRMING') {
        blockWith(PAYMENT_BLOCK_MESSAGE.CONFIRMING, await fetchLatestBooking(reservationId))
        return
      }
      if (err instanceof PaymentApiError && err.code && !err.retryable) {
        blockWith(message, await fetchLatestBooking(reservationId))
        return
      }
      setErrorMessage(message)
      setIsSubmitting(false)
    }
  }

  return (
    // 결제 정보 확인 중 바깥을 잘못 눌러 닫히는 걸 막기 위해, 오버레이 클릭으로는 닫지 않는다
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
          {!isToss && <span className="payment-modal-test-badge">TEST</span>}
          <h2 id="payment-modal-title" className="payment-modal-title">
            결제하기
          </h2>
        </div>
        {!isToss && (
          <p className="payment-modal-notice">
            모의 결제(MOCK)입니다. 토스 결제창 없이 테스트용 PG로 승인되며, 실제 결제는 발생하지 않습니다.
            {IS_PAYMENT_FAKE && ' (가짜 응답 모드: 서버를 호출하지 않습니다)'}
          </p>
        )}

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

        {isToss && (
          <div className="payment-modal-widget">
            {widgetStatus === 'loading' && <p className="payment-modal-widget-loading">결제 수단을 불러오는 중…</p>}
            <div id={TOSS_METHODS_ID} />
            <div id={TOSS_AGREEMENT_ID} />
          </div>
        )}

        {errorMessage && <p className="payment-modal-error">{errorMessage}</p>}

        <div className="payment-modal-actions">
          <button type="button" className="payment-modal-cancel" onClick={onClose} disabled={isSubmitting}>
            취소
          </button>
          <button
            type="button"
            className="payment-modal-confirm"
            onClick={handleConfirm}
            disabled={isSubmitting || isBlocked || (isToss && widgetStatus !== 'ready')}
          >
            {isSubmitting ? '결제 준비 중…' : `${summary.amount.toLocaleString()}원 결제하기`}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PaymentModal
