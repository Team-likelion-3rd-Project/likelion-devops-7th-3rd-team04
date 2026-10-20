import { useEffect, useMemo, useState } from 'react'
import { fetchAdminHotelRooms, fetchAdminHotels } from '../../api/adminApi'
import type { AdminHotel, AdminRoom } from '../../api/adminApi'
import {
  assignReservationRoomUnit,
  fetchUnitAssignmentBoard,
  IS_ROOM_UNIT_FAKE,
  roomUnitErrorMessage,
} from '../../api/roomUnits'
import type { RoomUnitAssignments, UnitAssignment, UnitAssignmentBoard } from '../../api/roomUnits'
import './AdminPages.css'

// 한 번에 볼 기간(일). 서버는 최대 31일까지 조회한다 (LDP-89 #171 API 7).
const PERIOD_OPTIONS = [7, 14, 31]

const RESERVATION_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: '결제 대기',
  RESERVED: '예약 확정',
}

const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

// toISOString()은 UTC 기준이라 KST 자정 근처에 하루 밀린다 → 로컬 연/월/일로 만든다.
function toISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDays(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00`)
  date.setDate(date.getDate() + days)
  return toISODate(date)
}

// [checkIn, checkOut) 숙박 기간이 겹치는지 (체크아웃 날은 비어 있다)
function overlaps(a: UnitAssignment, b: UnitAssignment): boolean {
  return a.checkInDate < b.checkOutDate && b.checkInDate < a.checkOutDate
}

// 화면에서 고른 예약 (배정된 예약이면 currentUnitId가 있다)
interface SelectedReservation extends UnitAssignment {
  roomId: number
  currentUnitId: number | null
}

// 호실 한 줄을 날짜 칸으로 나눈다: 예약이 있는 날은 숙박 기간만큼 칸을 합친다(colSpan).
function buildRowCells(dates: string[], assignments: UnitAssignment[]) {
  const cells: { date: string; span: number; assignment?: UnitAssignment }[] = []
  let i = 0
  while (i < dates.length) {
    const date = dates[i]
    const assignment = assignments.find((a) => a.checkInDate <= date && date < a.checkOutDate)
    if (!assignment) {
      cells.push({ date, span: 1 })
      i += 1
      continue
    }
    let span = 1
    while (i + span < dates.length && dates[i + span] < assignment.checkOutDate) span += 1
    cells.push({ date, span, assignment })
    i += span
  }
  return cells
}

// 기간별 호실 배정 현황: 호실 × 날짜 표에 배정된 예약을 보여주고, 미배정 예약을 호실에 배정·변경·해제한다.
// 예약은 자동 배정되지 않고 직원이 배정한다 (ERD #162). 같은 객실 종류의 사용 가능(ACTIVE) 호실에만,
// 같은 호실·겹치는 기간에 다른 배정이 없을 때만 배정할 수 있다 — 최종 판단은 서버가 하고, 화면은 고를 수 있는 호실만 보여준다.
function AdminRoomAssignmentsPage() {
  const [hotels, setHotels] = useState<AdminHotel[] | null>(null)
  const [hotelId, setHotelId] = useState<number | null>(null)
  const [roomTypes, setRoomTypes] = useState<AdminRoom[]>([])
  const [roomId, setRoomId] = useState<number | ''>('')
  const [startDate, setStartDate] = useState(() => toISODate(new Date()))
  const [period, setPeriod] = useState(PERIOD_OPTIONS[0])

  const [board, setBoard] = useState<UnitAssignmentBoard | null>(null)
  const [loadError, setLoadError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const [selected, setSelected] = useState<SelectedReservation | null>(null)
  const [targetUnitId, setTargetUnitId] = useState<number | ''>('')
  const [isSaving, setIsSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')

  const endDate = addDays(startDate, period - 1)
  const dates = useMemo(() => Array.from({ length: period }, (_, i) => addDays(startDate, i)), [startDate, period])
  const todayStr = toISODate(new Date())

  useEffect(() => {
    fetchAdminHotels()
      .then((data) => {
        setHotels(data)
        if (data.length > 0) setHotelId(data[0].hotelId)
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : '호텔 목록을 불러오지 못했습니다.'))
  }, [])

  useEffect(() => {
    if (hotelId === null) return
    let ignore = false
    fetchAdminHotelRooms(hotelId)
      .then((data) => {
        if (!ignore) setRoomTypes(data)
      })
      .catch(() => {
        if (!ignore) setRoomTypes([])
      })
    return () => {
      ignore = true
    }
  }, [hotelId])

  useEffect(() => {
    if (hotelId === null) return
    let ignore = false
    fetchUnitAssignmentBoard(hotelId, startDate, endDate, roomId === '' ? undefined : roomId)
      .then((data) => {
        if (ignore) return
        setBoard(data)
        setLoadError('')
      })
      .catch((err) => {
        if (!ignore) setLoadError(roomUnitErrorMessage(err, '호실 배정 현황을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [hotelId, startDate, endDate, roomId, reloadKey])

  // 고른 예약을 옮길 수 있는 호실: 같은 객실 종류 · 사용 가능 · 겹치는 기간에 다른 배정 없음 (지금 호실 제외)
  const candidateUnits = useMemo(() => {
    if (!board || !selected) return []
    return board.units.filter(
      (unit) =>
        unit.roomId === selected.roomId &&
        unit.status === 'ACTIVE' &&
        unit.roomUnitId !== selected.currentUnitId &&
        !unit.assignments.some((a) => a.reservationId !== selected.reservationId && overlaps(a, selected)),
    )
  }, [board, selected])

  const roomNameOf = (id: number) =>
    roomTypes.find((r) => r.roomId === id)?.name ?? board?.units.find((u) => u.roomId === id)?.roomName ?? `객실 ${id}`

  const selectReservation = (reservation: SelectedReservation) => {
    setSelected(reservation)
    setTargetUnitId('')
    setActionError('')
    setNotice('')
  }

  const selectAssigned = (unit: RoomUnitAssignments, assignment: UnitAssignment) =>
    selectReservation({ ...assignment, roomId: unit.roomId, currentUnitId: unit.roomUnitId })

  const changeAssignment = async (roomUnitId: number | null) => {
    if (!selected) return
    if (roomUnitId === null && !window.confirm(`${selected.guestName}님 예약의 호실 배정을 해제할까요?`)) return
    setIsSaving(true)
    setActionError('')
    try {
      const result = await assignReservationRoomUnit(selected.reservationId, roomUnitId)
      setNotice(
        roomUnitId === null
          ? `예약 #${selected.reservationId} 호실 배정을 해제했습니다.`
          : `예약 #${selected.reservationId}을(를) ${result.roomNumber}호에 배정했습니다.`,
      )
      setSelected(null)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setActionError(roomUnitErrorMessage(err, '호실을 배정하지 못했습니다.'))
    } finally {
      setIsSaving(false)
    }
  }

  const resetSelection = () => {
    setSelected(null)
    setNotice('')
  }

  return (
    <section>
      <div className="admin-page-header">
        <h1>호실 배정</h1>
      </div>
      <p className="admin-stat-note">
        예약은 자동으로 배정되지 않습니다. 미배정 예약을 같은 객실 종류의 사용 가능한 호실에 배정해주세요.
        {IS_ROOM_UNIT_FAKE && ' (가짜 데이터 모드: 서버를 호출하지 않고, 새로고침하면 처음 상태로 돌아갑니다)'}
      </p>

      <div className="admin-card">
        <div className="admin-assign-filters">
          <label className="admin-form-row">
            <span>지점</span>
            <select
              value={hotelId ?? ''}
              onChange={(e) => {
                setHotelId(Number(e.target.value))
                setRoomId('')
                resetSelection()
              }}
              disabled={!hotels}
            >
              {(hotels ?? []).map((hotel) => (
                <option key={hotel.hotelId} value={hotel.hotelId}>
                  {hotel.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>객실 종류</span>
            <select
              value={roomId}
              onChange={(e) => {
                setRoomId(e.target.value === '' ? '' : Number(e.target.value))
                resetSelection()
              }}
            >
              <option value="">전체</option>
              {roomTypes.map((room) => (
                <option key={room.roomId} value={room.roomId}>
                  {room.name}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-form-row">
            <span>시작일</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                if (e.target.value) setStartDate(e.target.value)
              }}
            />
          </label>
          <label className="admin-form-row">
            <span>기간</span>
            <select value={period} onChange={(e) => setPeriod(Number(e.target.value))}>
              {PERIOD_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days}일
                </option>
              ))}
            </select>
          </label>
          <div className="admin-assign-nav">
            <button type="button" className="admin-btn" onClick={() => setStartDate((d) => addDays(d, -period))}>
              ‹ 이전
            </button>
            <button type="button" className="admin-btn" onClick={() => setStartDate(todayStr)}>
              오늘
            </button>
            <button type="button" className="admin-btn" onClick={() => setStartDate((d) => addDays(d, period))}>
              다음 ›
            </button>
          </div>
        </div>
      </div>

      {loadError && <p className="admin-state is-error">{loadError}</p>}
      {!loadError && !board && <p className="admin-state">불러오는 중...</p>}
      {notice && <p className="admin-state is-success">{notice}</p>}

      {board && (
        <>
          <div className="admin-card">
            <div className="admin-card-header">
              <h2>
                호실 배정 현황 ({startDate} ~ {endDate})
              </h2>
            </div>
            {board.units.length === 0 ? (
              <p className="admin-state">등록된 호실이 없습니다. 객실 상세에서 호실을 추가해주세요.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-assign-board">
                  <thead>
                    <tr>
                      <th className="admin-assign-unit">호실</th>
                      {dates.map((date) => {
                        const day = new Date(`${date}T00:00:00`)
                        return (
                          <th key={date} className={date === todayStr ? 'is-today' : undefined}>
                            {day.getMonth() + 1}/{day.getDate()}
                            <br />
                            <small>{WEEKDAY_LABELS[day.getDay()]}</small>
                          </th>
                        )
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {board.units.map((unit) => (
                      <tr key={unit.roomUnitId} className={unit.status === 'OUT_OF_SERVICE' ? 'is-out-of-service' : undefined}>
                        <th className="admin-assign-unit">
                          {unit.roomNumber}호
                          <small>{unit.roomName}</small>
                          {unit.status === 'OUT_OF_SERVICE' && <span className="admin-badge is-bad">점검 중</span>}
                        </th>
                        {buildRowCells(dates, unit.assignments).map(({ date, span, assignment }) =>
                          assignment ? (
                            <td key={date} colSpan={span}>
                              <button
                                type="button"
                                className={`admin-assign-block is-${assignment.reservationStatus.toLowerCase()}${
                                  selected?.reservationId === assignment.reservationId ? ' is-selected' : ''
                                }`}
                                onClick={() => selectAssigned(unit, assignment)}
                                title={`예약 #${assignment.reservationId} · ${assignment.checkInDate} ~ ${assignment.checkOutDate}`}
                              >
                                {assignment.guestName}
                                <small>{RESERVATION_STATUS_LABEL[assignment.reservationStatus] ?? assignment.reservationStatus}</small>
                              </button>
                            </td>
                          ) : (
                            <td key={date} />
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="admin-calendar-legend">
              <span className="admin-calendar-legend-item">
                <span className="admin-assign-legend is-reserved" /> 예약 확정
              </span>
              <span className="admin-calendar-legend-item">
                <span className="admin-assign-legend is-pending_payment" /> 결제 대기
              </span>
              <span className="admin-calendar-legend-item">예약을 누르면 호실을 바꾸거나 배정을 해제할 수 있습니다.</span>
            </div>
          </div>

          {selected && (
            <div className="admin-card admin-assign-panel">
              <div className="admin-card-header">
                <h2>예약 #{selected.reservationId} 호실 {selected.currentUnitId ? '변경' : '배정'}</h2>
                <div className="admin-card-header-actions">
                  <button type="button" className="admin-btn" onClick={() => setSelected(null)} disabled={isSaving}>
                    닫기
                  </button>
                </div>
              </div>
              <p className="admin-stat-note">
                {selected.guestName} · {roomNameOf(selected.roomId)} · {selected.checkInDate} ~ {selected.checkOutDate} ·{' '}
                {RESERVATION_STATUS_LABEL[selected.reservationStatus] ?? selected.reservationStatus}
                {selected.currentUnitId &&
                  ` · 현재 ${board.units.find((u) => u.roomUnitId === selected.currentUnitId)?.roomNumber ?? ''}호`}
              </p>
              <div className="admin-assign-actions">
                <select
                  value={targetUnitId}
                  onChange={(e) => setTargetUnitId(e.target.value === '' ? '' : Number(e.target.value))}
                  disabled={isSaving}
                  aria-label="배정할 호실"
                >
                  <option value="">
                    {candidateUnits.length > 0 ? '호실 선택' : '이 기간에 비어 있는 호실이 없습니다'}
                  </option>
                  {candidateUnits.map((unit) => (
                    <option key={unit.roomUnitId} value={unit.roomUnitId}>
                      {unit.roomNumber}호{unit.floor !== null ? ` (${unit.floor}층)` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="admin-btn is-primary"
                  onClick={() => targetUnitId !== '' && changeAssignment(targetUnitId)}
                  disabled={isSaving || targetUnitId === ''}
                >
                  {isSaving ? '저장 중...' : selected.currentUnitId ? '이 호실로 변경' : '배정'}
                </button>
                {selected.currentUnitId && (
                  <button
                    type="button"
                    className="admin-btn is-danger"
                    onClick={() => changeAssignment(null)}
                    disabled={isSaving}
                  >
                    배정 해제
                  </button>
                )}
              </div>
              {actionError && <p className="admin-form-error">{actionError}</p>}
            </div>
          )}

          <div className="admin-card">
            <div className="admin-card-header">
              <h2>미배정 예약 ({board.unassigned.length}건)</h2>
            </div>
            {board.unassigned.length === 0 ? (
              <p className="admin-state">이 기간에 배정할 예약이 없습니다.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>예약 번호</th>
                      <th>객실 종류</th>
                      <th>투숙 기간</th>
                      <th>투숙객</th>
                      <th>상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    {board.unassigned.map((reservation) => (
                      <tr
                        key={reservation.reservationId}
                        className={selected?.reservationId === reservation.reservationId ? 'is-selected' : undefined}
                        onClick={() => selectReservation({ ...reservation, currentUnitId: null })}
                      >
                        <td>#{reservation.reservationId}</td>
                        <td>{roomNameOf(reservation.roomId)}</td>
                        <td>
                          {reservation.checkInDate} ~ {reservation.checkOutDate}
                        </td>
                        <td>{reservation.guestName}</td>
                        <td>{RESERVATION_STATUS_LABEL[reservation.reservationStatus] ?? reservation.reservationStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

export default AdminRoomAssignmentsPage
