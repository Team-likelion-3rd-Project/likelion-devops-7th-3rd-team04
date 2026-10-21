import type { RoomGuests } from './guestTypes'
import './GuestSelector.css'

const LIMITS = {
  adults: { min: 1, max: 4 },
  children: { min: 0, max: 3 },
  infants: { min: 0, max: 2 },
} as const

interface GuestSelectorProps {
  rooms: RoomGuests[]
  onChange: (rooms: RoomGuests[]) => void
  onBack: () => void
  onSubmit: () => void
}

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="guest-stepper">
      <span className="guest-stepper-label">{label}</span>
      <div className="guest-stepper-controls">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          disabled={value <= min}
          aria-label={`${label} 감소`}
        >
          −
        </button>
        <span className="guest-stepper-value">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          aria-label={`${label} 증가`}
        >
          +
        </button>
      </div>
    </div>
  )
}

/** "이용 인원" 패널. 객실별 성인/어린이/유아 수만 조절한다 — 객실 추가는 지원하지 않는다. */
function GuestSelector({ rooms, onChange, onBack, onSubmit }: GuestSelectorProps) {
  const updateRoom = (index: number, patch: Partial<RoomGuests>) => {
    onChange(rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)))
  }

  const removeRoom = (index: number) => {
    if (rooms.length <= 1) return
    onChange(rooms.filter((_, i) => i !== index))
  }

  return (
    <div className="guest-selector">
      {rooms.map((room, index) => (
        <div className="guest-selector-room" key={index}>
          <div className="guest-selector-room-header">
            <span className="guest-selector-room-title">객실</span>
            {rooms.length > 1 && (
              <button type="button" className="guest-selector-remove" onClick={() => removeRoom(index)}>
                삭제
              </button>
            )}
          </div>
          <div className="guest-selector-steppers">
            <Stepper
              label="성인"
              value={room.adults}
              min={LIMITS.adults.min}
              max={LIMITS.adults.max}
              onChange={(v) => updateRoom(index, { adults: v })}
            />
            <Stepper
              label="어린이"
              value={room.children}
              min={LIMITS.children.min}
              max={LIMITS.children.max}
              onChange={(v) => updateRoom(index, { children: v })}
            />
            <Stepper
              label="유아"
              value={room.infants}
              min={LIMITS.infants.min}
              max={LIMITS.infants.max}
              onChange={(v) => updateRoom(index, { infants: v })}
            />
          </div>
        </div>
      ))}

      <div className="guest-selector-footer-note">
        <p>※ 어린이 : 만 3세 ~ 만 12세 이하 / 유아 : 만 36개월 이하</p>
      </div>

      <div className="guest-selector-actions">
        <button type="button" className="guest-selector-back" onClick={onBack}>
          이전
        </button>
        <button type="button" className="guest-selector-submit" onClick={onSubmit}>
          객실 검색
        </button>
      </div>
    </div>
  )
}

export default GuestSelector
