import { ArrowRight, Check, X } from 'lucide-react'
import './ProceedBookingBar.css'

type ProceedBookingBarProps = {
  stayNames: string[]
  onProceed: () => void
  onDismiss: () => void
}

/** Pops up at the bottom after a guest picks a stay, so they can jump straight to the booking form. */
export default function ProceedBookingBar({ stayNames, onProceed, onDismiss }: ProceedBookingBarProps) {
  const count = stayNames.length
  return (
    <div className="proceed-bar" role="region" aria-label="Your selected accommodations">
      <span className="proceed-bar-check" aria-hidden="true"><Check size={17} strokeWidth={3} /></span>
      <span className="proceed-bar-text" aria-live="polite">
        <b>{count} {count === 1 ? 'stay' : 'stays'} selected</b>
        <small>{stayNames.join(', ')}</small>
      </span>
      <button type="button" className="proceed-bar-go" onClick={onProceed}>
        Proceed to Booking <ArrowRight size={17} />
      </button>
      <button type="button" className="proceed-bar-close" aria-label="Hide this message" onClick={onDismiss}><X size={18} /></button>
    </div>
  )
}
