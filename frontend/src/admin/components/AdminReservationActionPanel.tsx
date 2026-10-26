import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  adminCancelBooking,
  adminReservationErrorMessage,
  createExtensionBooking,
} from '../../api/adminReservations'
import type { AdminBooking } from '../../api/adminReservations'
import type { Payment } from '../../api/payments'
import { PAYMENT_STATUS_LABEL, formatPaidAt } from '../../utils/payment'
import { openDatePicker } from '../../utils/date'

export type ReservationAction = 'cancel' | 'extend'

interface AdminReservationActionPanelProps {
  booking: AdminBooking
  action: ReservationAction
  /** 표시용 "지점 · 객실 종류" */
  roomLabel: string
  guestName: string
  /** 이 예약의 가장 최근 결제 (결제 기록이 없거나 못 불러왔으면 없음) */
  payment?: Payment
  /** 이 예약을 원래 예약으로 하는 활성 연장 예약 (직원 취소 시 함께 취소됨) */
  activeExtensions: AdminBooking[]
  /** 이 예약 다음으로 이어지는 연장 예약 — 있으면 그 예약에서 연장해야 한다 */
  nextExtension?: AdminBooking
  onDone: (message: string) => void
  onClose: () => void
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const CANCEL_REASON_MAX = 255

// 고른 예약의 직원 취소(사유 필수) / 투숙 연장 (LDP-90). 처리 결과는 onDone 문구로 목록 위에 보여준다.
function AdminReservationActionPanel({
  booking,
  action,
  roomLabel,
  guestName,
  payment,
  activeExtensions,
  nextExtension,
  onDone,
  onClose,
}: AdminReservationActionPanelProps) {
  const [cancelReason, setCancelReason] = useState('')
  const [checkOutDate, setCheckOutDate] = useState(addDays(booking.checkOutDate, 1))
  const [keepSameRoomUnit, setKeepSameRoomUnit] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCancel = async () => {
    const reason = cancelReason.trim()
    if (!reason || reason.length > CANCEL_REASON_MAX) {
      setError(`취소 사유를 1~${CANCEL_REASON_MAX}자로 입력해 주세요.`)
      return
    }
    const withExtensions =
      activeExtensions.length > 0 ? `\n연결된 연장 예약 ${activeExtensions.length}건도 함께 취소됩니다.` : ''
    // 결제 상태에 맞춰 환불 여부를 안내한다 (결제 기록을 못 불러왔으면 예전 문구)
    const refundNote =
      payment?.status.toLowerCase() === 'approved'
        ? ` 결제된 ${payment.amount.toLocaleString()}원이 전액 환불됩니다.`
        : payment
          ? ''
          : ' 결제됐으면 전액 환불됩니다.'
    if (!window.confirm(`예약 #${booking.reservationId}을(를) 취소할까요?${refundNote}${withExtensions}`)) {
      return
    }
    setIsSaving(true)
    setError('')
    try {
      await adminCancelBooking(booking.reservationId, reason)
      onDone(
        `예약 #${booking.reservationId}을(를) 취소했습니다.` +
          (activeExtensions.length > 0 ? ` 연결된 연장 예약 ${activeExtensions.length}건도 함께 취소됐습니다.` : ''),
      )
    } catch (err) {
      setError(adminReservationErrorMessage(err, '예약을 취소하지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleExtend = async () => {
    if (!checkOutDate || checkOutDate <= booking.checkOutDate) {
      setError('연장 체크아웃은 지금 체크아웃보다 뒤 날짜여야 합니다.')
      return
    }
    setIsSaving(true)
    setError('')
    try {
      const created = await createExtensionBooking(booking.reservationId, checkOutDate, keepSameRoomUnit)
      const room = created.roomNumber
        ? ` ${created.roomNumber}호로 배정됐습니다.`
        : ' 호실은 미배정입니다 — 호실 배정 화면에서 배정해 주세요.'
      onDone(
        `연장 예약 #${created.reservationId}을(를) 만들었습니다 (${created.checkInDate} ~ ${created.checkOutDate}).${room} 손님 앱 결제 대기에 나타나고, 결제해야 확정됩니다.`,
      )
    } catch (err) {
      setError(adminReservationErrorMessage(err, '연장 예약을 만들지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="admin-card admin-assign-panel">
      <div className="admin-card-header">
        <h2>
          예약 #{booking.reservationId} {action === 'cancel' ? '직원 취소' : '투숙 연장'}
        </h2>
        <div className="admin-card-header-actions">
          <button type="button" className="admin-btn" onClick={onClose} disabled={isSaving}>
            닫기
          </button>
        </div>
      </div>
      <p className="admin-stat-note">
        {guestName} · {roomLabel} · {booking.checkInDate} ~ {booking.checkOutDate}
        {booking.roomNumber && ` · ${booking.roomNumber}호`}
      </p>
      <p className="admin-stat-note">
        결제:{' '}
        {payment ? (
          <>
            <strong>{PAYMENT_STATUS_LABEL[payment.status.toLowerCase()] ?? payment.status}</strong> ·{' '}
            {payment.amount.toLocaleString()}원{payment.paidAt && ` · 결제 ${formatPaidAt(payment.paidAt)}`}
            {payment.refundedAt && ` · 환불 ${formatPaidAt(payment.refundedAt)}`}
          </>
        ) : (
          '결제 기록 없음'
        )}
      </p>

      {action === 'cancel' ? (
        <div className="admin-form">
          <label className="admin-form-row">
            <span>취소 사유 (필수, 손님에게도 보입니다)</span>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              maxLength={CANCEL_REASON_MAX}
              placeholder="예: 손님 전화 요청, 노쇼, 중복 예약"
            />
          </label>
          {activeExtensions.length > 0 && (
            <p className="admin-stat-note">
              ⚠ 이 예약에 연결된 연장 예약({activeExtensions.map((e) => `#${e.reservationId}`).join(', ')})도 함께
              취소됩니다.
            </p>
          )}
          <div className="admin-form-actions">
            <button type="button" className="admin-btn is-danger" onClick={handleCancel} disabled={isSaving}>
              {isSaving ? '취소 중...' : '예약 취소'}
            </button>
          </div>
        </div>
      ) : nextExtension ? (
        <p className="admin-state">
          이 예약 다음으로 이어지는 연장 예약 #{nextExtension.reservationId}({nextExtension.checkInDate} ~{' '}
          {nextExtension.checkOutDate})이 있습니다. 더 연장하려면 그 예약에서 연장해 주세요.
        </p>
      ) : (
        <div className="admin-form">
          <div className="admin-assign-filters">
            <label className="admin-form-row">
              <span>연장 체크인 (지금 체크아웃)</span>
              <input type="date" value={booking.checkOutDate} disabled />
            </label>
            <label className="admin-form-row">
              <span>새 체크아웃</span>
              <input
                type="date"
                value={checkOutDate}
                min={addDays(booking.checkOutDate, 1)}
                onClick={openDatePicker}
                onChange={(e) => setCheckOutDate(e.target.value)}
              />
            </label>
          </div>
          <label className="admin-unit-check">
            <input
              type="checkbox"
              checked={keepSameRoomUnit}
              onChange={(e) => setKeepSameRoomUnit(e.target.checked)}
            />
            같은 호실 유지 (비어 있으면 같은 호실로 배정, 아니면 미배정 →{' '}
            <Link to="/admin/room-assignments">호실 배정</Link>)
          </label>
          <p className="admin-stat-note">
            같은 회원·객실 종류·인원으로 새 예약을 만듭니다. 손님이 결제해야 확정되며, 결제 마감은 오늘 밤 자정입니다.
          </p>
          <div className="admin-form-actions">
            <button type="button" className="admin-btn is-primary" onClick={handleExtend} disabled={isSaving}>
              {isSaving ? '연장 예약 만드는 중...' : '연장 예약 만들기'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="admin-form-error">{error}</p>}
    </div>
  )
}

export default AdminReservationActionPanel
