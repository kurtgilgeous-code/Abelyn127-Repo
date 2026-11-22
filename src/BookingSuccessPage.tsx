import { useEffect, useState } from 'react'
import { ArrowLeft, CircleDollarSign } from 'lucide-react'
import { fetchCustomerBookings } from './api/bookings'
import type { Booking } from './data/bookings'
import BookingReceiptModal from './BookingReceiptModal'
import { useAuth } from './auth/useAuth'
import { bookingReferenceFromLocation } from './bookingReturn'

export default function BookingSuccessPage() {
  const { user, token } = useAuth()
  const reference = bookingReferenceFromLocation()
  const [booking, setBooking] = useState<Booking | null>(null)
  const [error, setError] = useState('')
  const paymentConfirmed = Boolean(booking?.gatewayPaymentId)

  useEffect(() => {
    if (!token || !reference || paymentConfirmed) return
    let active = true
    const refresh = () => {
      fetchCustomerBookings(token)
        .then((items) => {
          if (!active) return
          const found = items.find((item) => item.referenceNumber === reference)
          if (found) {
            setBooking(found)
            setError('')
          } else {
            setError('We could not find this booking under the signed-in account.')
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : 'Could not load the booking status.')
        })
    }
    refresh()
    const interval = window.setInterval(refresh, 4000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [paymentConfirmed, reference, token])

  if (!user || !token) {
    const signInUrl = `/login?next=booking-success&reference=${encodeURIComponent(reference)}`
    return (
      <main className="booking-success-state">
        <CircleDollarSign size={28} />
        <h1>Sign in to view your receipt</h1>
        <p>Your payment is confirmed by HitPay’s secure webhook. Sign in with the account used to book to view the receipt.</p>
        <a href={signInUrl}>Sign in to continue</a>
      </main>
    )
  }

  if (!reference) {
    return (
      <main className="booking-success-state" role="alert">
        <h1>Booking reference missing</h1>
        <p>Return to the booking page and open your booking using its reference.</p>
        <a href="/customer/booking#my-inquiry"><ArrowLeft size={15} /> Customer booking</a>
      </main>
    )
  }

  if (booking && paymentConfirmed) return <BookingReceiptModal booking={booking} />

  return (
    <main className="booking-success-state" aria-live="polite">
      <CircleDollarSign size={28} />
      <span className="receipt-kicker">BOOKING REFERENCE · {reference}</span>
      <h1>Confirming your payment</h1>
      <p>HitPay sent the payment result securely. This page will show your official receipt as soon as the server verifies the webhook.</p>
      {booking && <p className="booking-success-substatus">{booking.accommodationName} · {booking.checkInDate}</p>}
      {error && <p className="booking-success-error" role="alert">{error}</p>}
      <a href="/customer/booking#my-inquiry"><ArrowLeft size={15} /> Back to your bookings</a>
    </main>
  )
}
