import { RESERVATION_STEPS } from './reservationStepsData'
import './ReservationSteps.css'

interface ReservationStepsProps {
  /** 현재 단계의 0-based index (RESERVATION_STEPS 기준) */
  activeStep: number
}

function ReservationSteps({ activeStep }: ReservationStepsProps) {
  return (
    <ol className="reservation-steps">
      {RESERVATION_STEPS.map((step, index) => (
        <li className="reservation-step-item" key={step}>
          <span className={`reservation-step-circle ${index === activeStep ? 'is-active' : ''}`}>
            {index + 1}
          </span>
          {index === activeStep && <span className="reservation-step-text">{step}</span>}
          {index < RESERVATION_STEPS.length - 1 && <span className="reservation-step-line" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  )
}

export default ReservationSteps
