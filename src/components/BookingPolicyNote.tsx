import { Info } from 'lucide-react'
import './BookingPolicyNote.css'

/** The resort's payment policy, shown before a guest commits and on every receipt. */
export default function BookingPolicyNote() {
  return (
    <p className="booking-policy-note">
      <Info size={15} aria-hidden="true" />
      <span>
        <b>No refunds.</b> Reasonable booking adjustments, such as a change of date, may be requested and are subject to availability and the resort&apos;s approval.
      </span>
    </p>
  )
}
