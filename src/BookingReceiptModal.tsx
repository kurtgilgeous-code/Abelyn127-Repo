import { useState } from 'react'
import { Printer, X } from 'lucide-react'
import type { Booking } from './data/bookings'
import { displayCheckoutDate, tourDetails } from './data/bookings'
import HoldCountdown from './components/HoldCountdown'
import { accommodations } from './data/accommodations'
import { calculateBookingTotal, formatPeso, priceAccommodations } from './utils/pricing'
import ResortLogo from './components/ResortLogo'
import './BookingReceiptModal.css'

export default function BookingReceiptModal({
  booking,
  onClose,
}: {
  booking: Booking
  onClose?: () => void
}) {
  const [printError, setPrintError] = useState('')
  const isOnline = booking.paymentTier === 'ONLINE_GCASH_RESERVATION'
  const isWalkIn = booking.paymentTier === 'WALKIN_CASH_NO_RESERVATION'
  const isHold = booking.paymentTier === 'PENDING_CASH_INQUIRY'
  const holdActive = isHold && booking.status === 'PENDING_HOLD' && Boolean(booking.expiresAt)
  const holdStatusText = booking.status === 'PENDING_HOLD'
    ? 'Walk-in voucher · awaiting cash payment'
    : booking.status === 'EXPIRED'
      ? 'Expired after 24 hours · dates released'
      : booking.status === 'CANCELLED_BY_GCASH_PRIORITY'
        ? 'Released · another booking was confirmed first'
        : booking.status
  const isExclusive = booking.accommodationIds.some((id) => id === 'abelyns-cabin-glass' || id === 'balai-delnor')
  const paymentConfirmed = isWalkIn || Boolean(booking.gatewayPaymentId)
  const cashBalance = Math.max(0, booking.baseResortPrice - booking.paidAmount)

  // Itemized room rate and entrance fees, recalculated from the booking's own details. Shown
  // only when it matches the amount actually charged (older bookings priced under earlier
  // rates keep the single total line).
  const stayDays = Math.max(1, Math.round(
    (Date.parse(`${booking.checkOutDate}T00:00:00Z`) - Date.parse(`${booking.checkInDate}T00:00:00Z`)) / 86_400_000,
  ))
  const bookedStays = accommodations.filter((stay) => booking.accommodationIds.includes(stay.id))
  const breakdown = bookedStays.length ? calculateBookingTotal(bookedStays, booking.guests, stayDays, booking.tourType, booking.extraGuests) : null
  const showBreakdown = Boolean(breakdown && Math.abs(breakdown.grandTotal - booking.baseResortPrice) < 0.01)
  const pricedStays = priceAccommodations(bookedStays, booking.tourType, stayDays)
  const dayLabel = `${stayDays} ${stayDays === 1 ? 'day' : 'days'}`
  const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
  const entranceLines = breakdown ? ([
    ['adults', plural(breakdown.chargeable.adults, 'adult', 'adults'), breakdown.chargeable.adults, breakdown.entranceRate.adults],
    ['seniorsPwd', plural(breakdown.chargeable.seniorsPwd, 'senior/PWD', 'seniors/PWD'), breakdown.chargeable.seniorsPwd, breakdown.entranceRate.seniorsPwd],
    ['children', plural(breakdown.chargeable.children, 'child', 'children'), breakdown.chargeable.children, breakdown.entranceRate.children],
  ] as const).filter(([, , count]) => count > 0) : []
  const guestMix = [
    booking.guests.adults && plural(booking.guests.adults, 'adult', 'adults'),
    booking.guests.seniorsPwd && plural(booking.guests.seniorsPwd, 'senior/PWD', 'seniors/PWD'),
    booking.guests.children && plural(booking.guests.children, 'child', 'children'),
  ].filter(Boolean).join(', ')

  const printReceipt = () => {
    try {
      window.print()
      setPrintError('')
    } catch (error) {
      console.error('Could not open the print dialog for the booking receipt:', error)
      setPrintError('Your browser could not open the print dialog. Please try again.')
    }
  }

  const content = (
    <article className="official-receipt receipt-printing">
      <header className="receipt-heading">
        <ResortLogo className="receipt-logo" tone="print" />
        <span className="receipt-kicker">TAMPISAWAN 927 · ABELYN&apos;S PRIVATE POOL</span>
        <h1>{isHold ? 'Walk-In Voucher' : 'Official Booking Receipt'}</h1>
        <p>{isHold ? 'Show this voucher at the resort and pay in cash within 24 hours. Your dates are confirmed once the cash is received.' : 'Keep this receipt for check-in and payment reference.'}</p>
      </header>
      <dl className="receipt-reference-grid">
        <div><dt>Booking reference</dt><dd>{booking.referenceNumber}</dd></div>
        <div><dt>Payment tier</dt><dd>{isOnline ? '1. GCash Reservation' : isWalkIn ? '2. Walk-In Cash' : isHold ? '2. Walk-In Cash (voucher)' : 'Manual / Legacy Booking'}</dd></div>
        {isHold ? (
          <div><dt>Voucher valid until</dt><dd>{booking.expiresAt ? new Date(booking.expiresAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}{holdActive && booking.expiresAt && <> · <HoldCountdown expiresAt={booking.expiresAt} /> left</>}</dd></div>
        ) : (
          <div><dt>HitPay transaction ID</dt><dd>{booking.gatewayPaymentId ?? (isOnline ? 'Awaiting payment confirmation' : 'Not applicable')}</dd></div>
        )}
        <div><dt>Booking status</dt><dd>{isHold ? holdStatusText : booking.status === 'DATE_UNAVAILABLE' ? 'Payment received · dates unavailable' : booking.status}</dd></div>
        {booking.holdReferenceNumber && <div><dt>Original hold reference</dt><dd>{booking.holdReferenceNumber}</dd></div>}
      </dl>
      <section className="receipt-stay-details">
        <h2>Stay details</h2>
        <div><span>Guest</span><b>{booking.customerName || 'Guest'}</b></div>
        <div><span>Accommodation</span><b>{booking.accommodationName}</b></div>
        <div><span>Access highlight</span><b>{isExclusive ? '✨ Exclusive / Solo Use of Entire Resort & Private Pool' : 'Standard Shared-Pool Access'}</b></div>
        <div><span>Tour package</span><b>{tourDetails[booking.tourType].label} · {tourDetails[booking.tourType].duration}</b></div>
        <div><span>Dates</span><b>{booking.checkInDate} – {displayCheckoutDate(booking.checkOutDate, booking.tourType)}</b></div>
        <div><span>Guests</span><b>{booking.guestCount}{guestMix && ` (${guestMix})`}</b></div>
        {showBreakdown && breakdown && (
          <div>
            <span>Entrance</span>
            <b>{breakdown.everyGuestPaysEntrance
              ? 'Paid for every guest'
              : breakdown.chargeableGuests > 0
                ? `Included for ${breakdown.includedPax} pax · ${plural(breakdown.chargeableGuests, 'extra guest', 'extra guests')}`
                : `Included for up to ${breakdown.includedPax} pax`}</b>
          </div>
        )}
      </section>
      <section className="receipt-financials">
        <h2>Itemized payment</h2>
        {showBreakdown && breakdown && (
          <>
            {pricedStays.map((stay) => (
              <div className="receipt-financial-row receipt-item-row" key={stay.id}>
                <span>{stay.name} · {dayLabel} × {formatPeso(stay.baseRate)}</span>
                <b>{formatPeso(stay.baseRate * stayDays)}</b>
              </div>
            ))}
            {entranceLines.map(([key, label, count, rate]) => (
              <div className="receipt-financial-row receipt-item-row" key={key}>
                <span>{breakdown.everyGuestPaysEntrance ? 'Entrance' : 'Extra guest entrance'} · {label} × {formatPeso(rate)}{stayDays > 1 ? ` × ${dayLabel}` : ''}</span>
                <b>{formatPeso(count * rate * stayDays)}</b>
              </div>
            ))}
            {entranceLines.length === 0 && (
              <div className="receipt-financial-row receipt-item-row"><span>Entrance fees (included for up to {breakdown.includedPax} pax)</span><b>{formatPeso(0)}</b></div>
            )}
          </>
        )}
        <div className={`receipt-financial-row${showBreakdown ? ' receipt-subtotal' : ''}`}><span>{showBreakdown ? 'Total resort rate' : 'Resort accommodation & entrance rates'}</span><b>{formatPeso(booking.baseResortPrice)}</b></div>
        {isOnline && (
          <>
            <div className="receipt-financial-row"><span>50% base resort reservation deposit</span><b>{formatPeso(booking.baseDepositAmount)}</b></div>
            <div className="receipt-financial-row"><span>Online gateway &amp; convenience fee (2.5%)</span><b>{formatPeso(booking.gatewayFeeAmount)}</b></div>
            <div className="receipt-financial-row receipt-total">
              <span>{paymentConfirmed ? 'Total GCash paid' : 'Total GCash payment due'}</span>
              <b>{formatPeso(booking.totalOnlinePaid)}</b>
            </div>
            <div className="receipt-financial-row"><span>Remaining cash balance at check-in</span><b>{formatPeso(cashBalance)}</b></div>
          </>
        )}
        {isWalkIn && (
          <>
            <div className="receipt-financial-row"><span>Online gateway fee</span><b>{formatPeso(0)}</b></div>
            <div className="receipt-financial-row receipt-total"><span>Cash received at walk-in</span><b>{formatPeso(booking.paidAmount)}</b></div>
            <div className="receipt-financial-row"><span>Remaining cash balance</span><b>{formatPeso(cashBalance)}</b></div>
          </>
        )}
        {isHold && (
          <>
            <div className="receipt-financial-row"><span>Online gateway fee</span><b>{formatPeso(0)}</b></div>
            <div className="receipt-financial-row receipt-total"><span>Cash due at the resort</span><b>{formatPeso(booking.baseResortPrice)}</b></div>
            <div className="receipt-financial-row"><span>Paid so far</span><b>{formatPeso(booking.paidAmount)}</b></div>
          </>
        )}
        {!isOnline && !isWalkIn && !isHold && (
          <div className="receipt-financial-row receipt-total"><span>Recorded amount paid</span><b>{formatPeso(booking.paidAmount)}</b></div>
        )}
      </section>
      {!paymentConfirmed && isOnline && (
        <p className="receipt-pending-note">This receipt becomes official after HitPay confirms payment through its signed webhook.</p>
      )}
      {isHold && (
        <p className="receipt-pending-note">First come, first served: a walk-in voucher does not reserve the date. The dates stay open to other guests until a booking is confirmed (a verified GCash deposit or cash paid at the resort). The voucher is valid for 24 hours.</p>
      )}
      {booking.status === 'DATE_UNAVAILABLE' && (
        <p className="receipt-pending-note">Payment was received after another confirmed booking secured these dates. Contact the resort for refund or alternative-date follow-up.</p>
      )}
      <footer className="receipt-footer">
        <span>Tampisawan 927 Abelyn&apos;s Private Pool</span>
        <span>Generated {new Date(booking.createdAt).toLocaleString('en-PH')}</span>
      </footer>
      {printError && <p className="receipt-print-error" role="alert">{printError}</p>}
      <div className="receipt-actions">
        <button type="button" className="receipt-print-button" onClick={printReceipt}><Printer size={16} /> Print / Save as PDF</button>
      </div>
    </article>
  )

  if (!onClose) return <main className="receipt-page">{content}</main>

  return (
    <div className="receipt-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="receipt-modal" role="dialog" aria-modal="true" aria-label={isHold ? 'Walk-in voucher' : 'Official booking receipt'}>
        <button className="receipt-close" type="button" aria-label="Close receipt" onClick={onClose}><X size={18} /></button>
        {content}
      </section>
    </div>
  )
}
