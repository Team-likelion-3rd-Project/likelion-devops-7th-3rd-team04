import { useMemo, useState } from 'react'
import {
  addMonths,
  formatMonthTitle,
  getMonthCells,
  isBeforeDay,
  isSameDay,
  isWithinRange,
  startOfDay,
  startOfMonth,
} from '../../utils/date'
import { ChevronLeftIcon, ChevronRightIcon } from './icons'
import './DateRangeCalendar.css'

interface DateRangeCalendarProps {
  checkIn: Date | null
  checkOut: Date | null
  /** 날짜를 하나 고르거나(체크아웃 null) 구간을 완성하면(체크아웃 확정) 호출 */
  onSelect: (checkIn: Date, checkOut: Date | null) => void
  /** "이전" 버튼을 눌렀을 때 — 호텔/지역 선택 단계로 돌아간다 */
  onBack: () => void
  /** 체크인/체크아웃이 모두 정해진 뒤 "인원선택" 버튼을 눌렀을 때 */
  onConfirm: () => void
}

// 예약 가능 기간을 오늘로부터 11개월 뒤 달까지로 제한 — 무한정 미래로 넘어가지 않도록
const MAX_MONTHS_AHEAD = 11

/** 체크인/체크아웃 선택용 2개월 달력. 좌우 화살표로 두 달을 함께 한 달씩 넘긴다. */
function DateRangeCalendar({ checkIn, checkOut, onSelect, onBack, onConfirm }: DateRangeCalendarProps) {
  const today = useMemo(() => startOfDay(new Date()), [])
  const earliestMonth = useMemo(() => startOfMonth(today), [today])
  const latestMonth = useMemo(() => addMonths(earliestMonth, MAX_MONTHS_AHEAD), [earliestMonth])

  const [viewMonth, setViewMonth] = useState(() => startOfMonth(checkIn ?? today))

  const canGoPrev = viewMonth.getTime() > earliestMonth.getTime()
  const canGoNext = viewMonth.getTime() < latestMonth.getTime()

  const handleDayClick = (date: Date) => {
    if (isBeforeDay(date, today)) return

    if (!checkIn || checkOut) {
      // 처음 고르는 중이거나, 이미 구간이 완성된 상태에서 새로 고르기 시작
      onSelect(date, null)
      return
    }
    if (isBeforeDay(date, checkIn) || isSameDay(date, checkIn)) {
      // 체크인보다 이전(또는 같은) 날짜를 고르면 그 날짜부터 다시 선택
      onSelect(date, null)
      return
    }
    onSelect(checkIn, date)
  }

  const months = [viewMonth, addMonths(viewMonth, 1)]

  return (
    <div className="date-range-calendar">
      <div className="date-range-calendar-months">
        <button
          type="button"
          className="date-range-nav prev"
          onClick={() => setViewMonth((m) => addMonths(m, -1))}
          disabled={!canGoPrev}
          aria-label="이전 달"
        >
          <ChevronLeftIcon />
        </button>

        {months.map((month) => (
          <div className="date-range-month" key={formatMonthTitle(month)}>
            <p className="date-range-month-title">{formatMonthTitle(month)}</p>
            <div className="date-range-weekdays">
              {['일', '월', '화', '수', '목', '금', '토'].map((w, i) => (
                <span key={w} className={i === 0 ? 'is-sunday' : ''}>
                  {w}
                </span>
              ))}
            </div>
            <div className="date-range-days">
              {getMonthCells(month).map((date, i) => {
                if (!date) return <span key={i} className="date-range-day is-empty" />

                const isPast = isBeforeDay(date, today)
                const isToday = isSameDay(date, today)
                const isStart = checkIn ? isSameDay(date, checkIn) : false
                const isEnd = checkOut ? isSameDay(date, checkOut) : false
                const inRange = checkIn && checkOut ? isWithinRange(date, checkIn, checkOut) : false
                const isSunday = date.getDay() === 0

                return (
                  <button
                    key={i}
                    type="button"
                    className={[
                      'date-range-day',
                      isPast && 'is-disabled',
                      (isStart || isEnd) && 'is-selected',
                      inRange && 'is-in-range',
                      // 체크인/체크아웃이 붙어있는 날짜끼리는 원 사이를 이어주는 바를 그린다
                      isStart && checkOut && 'is-range-start',
                      isEnd && 'is-range-end',
                      isSunday && !isPast && 'is-sunday',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={isPast}
                    onClick={() => handleDayClick(date)}
                  >
                    <span className="date-range-day-number">{date.getDate()}</span>
                    {isToday && <span className="date-range-day-caption">오늘</span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <button
          type="button"
          className="date-range-nav next"
          onClick={() => setViewMonth((m) => addMonths(m, 1))}
          disabled={!canGoNext}
          aria-label="다음 달"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div className="date-range-calendar-footer">
        <p className="date-range-calendar-hint">
          ※ 체크인 날짜를 먼저 선택한 뒤 체크아웃 날짜를 선택해주세요.
        </p>
        <div className="date-range-calendar-actions">
          <button type="button" className="date-range-back" onClick={onBack}>
            이전
          </button>
          <button type="button" className="date-range-confirm" disabled={!checkIn || !checkOut} onClick={onConfirm}>
            인원선택
          </button>
        </div>
      </div>
    </div>
  )
}

export default DateRangeCalendar
