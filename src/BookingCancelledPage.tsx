import { ArrowLeft, RefreshCw, XCircle } from 'lucide-react'
import ResortLogo from './components/ResortLogo'
import { useAuth } from './auth/useAuth'
import { bookingReferenceFromLocation } from './bookingReturn'

export default function BookingCancelledPage() {
  const { user } = useAuth()
  const reference = bookingReferenceFromLocation()

  return (
    <main className="booking-cancelled-state" role="main" aria-labelledby="cancelled-title">
      <div className="booking-cancelled-card">
        <ResortLogo className="receipt-logo" />
        <div className="cancelled-icon-wrap" aria-hidden="true">
          <XCircle size={36} />
        </div>
        {reference && (
          <span className="receipt-kicker">
            BOOKING REFERENCE · {reference}
          </span>
        )}
        <h1 id="cancelled-title">GCash Checkout Cancelled</h1>
        <p>
          Your checkout session was cancelled. No payment was deducted from your GCash account,
          and your reservation deposit has not been charged.
        </p>
        <p className="cancelled-note">
          Your dates are not confirmed until a reservation deposit is completed. You can try the
          checkout again whenever you are ready.
        </p>

        <div className="cancelled-actions">
          <a className="button-retry" href={user ? '/#booking' : '/#booking'}>
            <RefreshCw size={15} /> Try booking again
          </a>
          <a className="button-secondary" href="/#stays">
            <ArrowLeft size={15} /> View accommodations &amp; rates
          </a>
          {user && (
            <a className="button-tertiary" href="/#my-inquiry">
              Check my bookings &amp; payments
            </a>
          )}
        </div>
      </div>
    </main>
  )
}
