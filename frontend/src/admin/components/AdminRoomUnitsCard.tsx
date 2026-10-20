import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createRoomUnit,
  fetchRoomUnits,
  IS_ROOM_UNIT_FAKE,
  roomUnitErrorMessage,
  updateRoomUnit,
  updateRoomUnitStatus,
} from '../../api/roomUnits'
import type { RoomUnit, RoomUnitInput } from '../../api/roomUnits'

interface AdminRoomUnitsCardProps {
  hotelId: string
  roomId: string
}

const ROOM_NUMBER_MAX_LENGTH = 10

// 폼 값(문자열) → 요청 바디. 방 번호는 필수, 층은 비우면 보내지 않는다.
function toRoomUnitInput(roomNumber: string, floor: string): RoomUnitInput | string {
  const trimmed = roomNumber.trim()
  if (!trimmed) return '방 번호를 입력해주세요.'
  if (floor.trim() === '') return { roomNumber: trimmed }
  const floorNum = Number(floor)
  if (!Number.isInteger(floorNum)) return '층은 정수로 입력해주세요.'
  return { roomNumber: trimmed, floor: floorNum }
}

// 객실 종류(roomId)에 속한 실제 호실(101호·102호…) 목록과 추가·수정·점검 처리 (LDP-89 #171 API 1·3·4·5).
// 보유 수량은 사용 가능(ACTIVE) 호실 수로 서버가 자동 계산하므로 여기서 직접 입력하지 않는다.
// 호실 삭제는 없다 — 배정 이력을 남기려고 점검(OUT_OF_SERVICE)으로 대신한다.
function AdminRoomUnitsCard({ hotelId, roomId }: AdminRoomUnitsCardProps) {
  const [units, setUnits] = useState<RoomUnit[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busyUnitId, setBusyUnitId] = useState<number | null>(null)

  const [isAdding, setIsAdding] = useState(false)
  const [newNumber, setNewNumber] = useState('')
  const [newFloor, setNewFloor] = useState('')
  const [isCreating, setIsCreating] = useState(false)

  const [editingUnitId, setEditingUnitId] = useState<number | null>(null)
  const [editNumber, setEditNumber] = useState('')
  const [editFloor, setEditFloor] = useState('')

  useEffect(() => {
    let ignore = false
    fetchRoomUnits(hotelId, roomId)
      .then((data) => {
        if (!ignore) setUnits(data)
      })
      .catch((err) => {
        if (!ignore) setLoadError(roomUnitErrorMessage(err, '호실 목록을 불러오지 못했습니다.'))
      })
    return () => {
      ignore = true
    }
  }, [hotelId, roomId])

  const replaceUnit = (updated: RoomUnit) => {
    setUnits((prev) => (prev ?? []).map((u) => (u.roomUnitId === updated.roomUnitId ? updated : u)))
  }

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const input = toRoomUnitInput(newNumber, newFloor)
    if (typeof input === 'string') {
      setActionError(input)
      return
    }
    setIsCreating(true)
    setActionError('')
    try {
      const created = await createRoomUnit(hotelId, roomId, input)
      setUnits((prev) => [...(prev ?? []), created])
      setNewNumber('')
      setNewFloor('')
      setIsAdding(false)
    } catch (err) {
      setActionError(roomUnitErrorMessage(err, '호실을 추가하지 못했습니다.'))
    } finally {
      setIsCreating(false)
    }
  }

  const openEdit = (unit: RoomUnit) => {
    setEditingUnitId(unit.roomUnitId)
    setEditNumber(unit.roomNumber)
    setEditFloor(unit.floor === null ? '' : String(unit.floor))
    setActionError('')
  }

  const handleUpdate = async (unit: RoomUnit) => {
    const input = toRoomUnitInput(editNumber, editFloor)
    if (typeof input === 'string') {
      setActionError(input)
      return
    }
    setBusyUnitId(unit.roomUnitId)
    setActionError('')
    try {
      replaceUnit(await updateRoomUnit(hotelId, unit.roomUnitId, input))
      setEditingUnitId(null)
    } catch (err) {
      setActionError(roomUnitErrorMessage(err, '호실을 수정하지 못했습니다.'))
    } finally {
      setBusyUnitId(null)
    }
  }

  const handleToggleStatus = async (unit: RoomUnit) => {
    const toOutOfService = unit.status === 'ACTIVE'
    if (
      toOutOfService &&
      !window.confirm(`${unit.roomNumber}호를 점검 처리할까요? 점검 중에는 예약 배정이 안 되고 보유 수량이 1 줄어듭니다.`)
    ) {
      return
    }
    setBusyUnitId(unit.roomUnitId)
    setActionError('')
    try {
      replaceUnit(await updateRoomUnitStatus(hotelId, unit.roomUnitId, toOutOfService ? 'OUT_OF_SERVICE' : 'ACTIVE'))
    } catch (err) {
      setActionError(roomUnitErrorMessage(err, '호실 상태를 바꾸지 못했습니다.'))
    } finally {
      setBusyUnitId(null)
    }
  }

  const activeCount = units?.filter((u) => u.status === 'ACTIVE').length ?? 0
  const outOfServiceCount = (units?.length ?? 0) - activeCount

  return (
    <div className="admin-card">
      <div className="admin-card-header">
        <h2>호실</h2>
        {!isAdding && units && (
          <div className="admin-card-header-actions">
            <button
              type="button"
              className="admin-btn is-primary"
              onClick={() => {
                setIsAdding(true)
                setActionError('')
              }}
            >
              호실 추가
            </button>
          </div>
        )}
      </div>

      {IS_ROOM_UNIT_FAKE && (
        <p className="admin-stat-note">가짜 데이터 모드: 서버를 호출하지 않고, 새로고침하면 처음 상태로 돌아갑니다.</p>
      )}

      {loadError && <p className="admin-state is-error">{loadError}</p>}
      {!loadError && !units && <p className="admin-state">불러오는 중...</p>}

      {units && (
        <>
          <p className="admin-stat-note">
            보유 수량 <strong>{activeCount}</strong>개 (사용 가능 호실 수) · 점검 중 {outOfServiceCount}개
          </p>

          {isAdding && (
            <form className="admin-form admin-unit-form" onSubmit={handleCreate} noValidate>
              <label className="admin-form-row">
                <span>방 번호</span>
                <input
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  maxLength={ROOM_NUMBER_MAX_LENGTH}
                  placeholder="예: 201"
                  required
                />
              </label>
              <label className="admin-form-row">
                <span>층 (선택)</span>
                <input type="number" value={newFloor} onChange={(e) => setNewFloor(e.target.value)} placeholder="예: 2" />
              </label>
              <div className="admin-form-actions">
                <button type="submit" className="admin-btn is-primary" disabled={isCreating}>
                  {isCreating ? '추가 중...' : '추가'}
                </button>
                <button type="button" className="admin-btn" onClick={() => setIsAdding(false)} disabled={isCreating}>
                  취소
                </button>
              </div>
            </form>
          )}

          {actionError && <p className="admin-form-error">{actionError}</p>}

          {units.length === 0 ? (
            <p className="admin-state">등록된 호실이 없습니다. 호실을 추가해주세요.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>방 번호</th>
                    <th>층</th>
                    <th>상태</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {units.map((unit) => {
                    const isEditing = editingUnitId === unit.roomUnitId
                    const isBusy = busyUnitId === unit.roomUnitId
                    return (
                      <tr key={unit.roomUnitId}>
                        <td>
                          {isEditing ? (
                            <input
                              className="admin-unit-input"
                              value={editNumber}
                              onChange={(e) => setEditNumber(e.target.value)}
                              maxLength={ROOM_NUMBER_MAX_LENGTH}
                              aria-label="방 번호"
                            />
                          ) : (
                            `${unit.roomNumber}호`
                          )}
                        </td>
                        <td>
                          {isEditing ? (
                            <input
                              className="admin-unit-input"
                              type="number"
                              value={editFloor}
                              onChange={(e) => setEditFloor(e.target.value)}
                              aria-label="층"
                            />
                          ) : unit.floor === null ? (
                            '-'
                          ) : (
                            `${unit.floor}층`
                          )}
                        </td>
                        <td>
                          <span className={`admin-badge ${unit.status === 'ACTIVE' ? 'is-good' : 'is-bad'}`}>
                            {unit.status === 'ACTIVE' ? '사용 가능' : '점검 중'}
                          </span>
                        </td>
                        <td>
                          <div className="admin-unit-actions">
                            {isEditing ? (
                              <>
                                <button
                                  type="button"
                                  className="admin-btn is-primary"
                                  onClick={() => handleUpdate(unit)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? '저장 중...' : '저장'}
                                </button>
                                <button
                                  type="button"
                                  className="admin-btn"
                                  onClick={() => setEditingUnitId(null)}
                                  disabled={isBusy}
                                >
                                  취소
                                </button>
                              </>
                            ) : (
                              <>
                                <button type="button" className="admin-btn" onClick={() => openEdit(unit)} disabled={isBusy}>
                                  수정
                                </button>
                                <button
                                  type="button"
                                  className={`admin-btn ${unit.status === 'ACTIVE' ? 'is-danger' : ''}`}
                                  onClick={() => handleToggleStatus(unit)}
                                  disabled={isBusy}
                                >
                                  {unit.status === 'ACTIVE' ? '점검 처리' : '점검 해제'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default AdminRoomUnitsCard
