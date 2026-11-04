import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Search,
  ShieldAlert,
  Users,
  Waves,
  X,
} from 'lucide-react'
import {
  type Booking,
  type BookingStatus,
  displayCheckoutDate,
  tourDetails,
} from './data/bookings'
import {
  fetchAdminBookings,
  recordCashPayment as saveCashPayment,
  reviewPayment as savePaymentReview,
  updateBookingReview as saveBookingReview,
} from './api/bookings'
import { formatPeso } from './utils/pricing'
import { useAuth } from './auth/useAuth'
import './AdminPage.css'

type Queue =
  | 'ALL_INQUIRIES'
  | 'DP_PENDING'
  | 'DP_SUCCESSFUL'
  | 'DP_CANCELLED'
  | 'DP_NOT_RECEIVED'
  | 'DP_PAID'
  | 'DP_FULLY_PAID'
  | 'DP_EARLY_PENDING'
  | 'DP_DATE_UNAVAILABLE'
  | 'FP_PENDING'
  | 'FP_CONFIRMED'
  | 'FP_CANCELLED'
  | 'FP_DATE_UNAVAILABLE'

type QueueGroup = 'ALL' | 'DOWN_PAYMENTS' | 'FULL_PAYMENT'

const queueTabs: Record<QueueGroup, { id: Queue; label: string }[]> = {
  ALL: [{ id: 'ALL_INQUIRIES', label: 'All Inquiries' }],
  DOWN_PAYMENTS: [
    { id: 'DP_PENDING', label: 'Pending DownPayment' },
    { id: 'DP_SUCCESSFUL', label: 'Successful' },
    { id: 'DP_CANCELLED', label: 'Cancelled' },
    { id: 'DP_NOT_RECEIVED', label: "Didn't receive" },
    { id: 'DP_PAID', label: 'Paid Downpayment' },
    { id: 'DP_EARLY_PENDING', label: 'Pending Early Payment' },
    { id: 'DP_FULLY_PAID', label: 'Fully Paid Downpayment' },
    { id: 'DP_DATE_UNAVAILABLE', label: 'Date unavailable · follow-up' },
  ],
  FULL_PAYMENT: [
    { id: 'FP_PENDING', label: 'Pending Full Payment' },
    { id: 'FP_CONFIRMED', label: 'Confirmed' },
    { id: 'FP_CANCELLED', label: 'Cancelled Full Payment' },
    { id: 'FP_DATE_UNAVAILABLE', label: 'Date unavailable · follow-up' },
  ],
}

function receivedPayments(booking: Booking) {
  return booking.payments
    .filter((payment) => payment.status === 'RECEIVED')
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
}

function initialPayment(booking: Booking) {
  return [...booking.payments].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))[0]
}

function isDownPaymentBooking(booking: Booking) {
  const payment = initialPayment(booking)
  return Boolean(payment && payment.amount < booking.estimatedTotal)
}

function isFullPaymentBooking(booking: Booking) {
  const payment = initialPayment(booking)
  return Boolean(payment && payment.amount >= booking.estimatedTotal)
}

function isPendingInitialPayment(booking: Booking, full: boolean) {
  return booking.status !== 'CANCELLED' &&
    booking.paidAmount === 0 &&
    (full ? isFullPaymentBooking(booking) : isDownPaymentBooking(booking)) &&
    booking.payments.some((payment) =>
      payment.status === 'PENDING_REVIEW',
    )
}

function isRejectedInitialPayment(booking: Booking, full: boolean) {
  return booking.paidAmount === 0 &&
    (full ? isFullPaymentBooking(booking) : isDownPaymentBooking(booking)) &&
    booking.payments.some((payment) => payment.status === 'NOT_RECEIVED')
}

function hasPendingEarlyPayment(booking: Booking) {
  return booking.status !== 'CANCELLED' &&
    booking.paidAmount > 0 &&
    booking.payments.some((payment) => payment.status === 'PENDING_REVIEW')
}

function isSuccessfulDownPayment(booking: Booking) {
  return booking.status === 'CONFIRMED' &&
    isDownPaymentBooking(booking) &&
    receivedPayments(booking).length > 0
}

function isFullyPaidByDownPayment(booking: Booking) {
  return booking.status === 'CONFIRMED' &&
    booking.paymentStatus === 'PAID' &&
    isDownPaymentBooking(booking) &&
    receivedPayments(booking).some((payment) => payment.amount < booking.estimatedTotal) &&
    receivedPayments(booking).length > 1
}

function queueMatches(booking: Booking, queue: Queue) {
  switch (queue) {
    case 'ALL_INQUIRIES':
      return booking.status === 'PENDING'
    case 'DP_PENDING':
      return isPendingInitialPayment(booking, false)
    case 'DP_SUCCESSFUL':
      return isSuccessfulDownPayment(booking)
    case 'DP_CANCELLED':
      return booking.status === 'CANCELLED' && isDownPaymentBooking(booking)
    case 'DP_NOT_RECEIVED':
      return booking.status !== 'CANCELLED' &&
        isRejectedInitialPayment(booking, false) &&
        !isSuccessfulDownPayment(booking)
    case 'DP_PAID':
      return isSuccessfulDownPayment(booking) && booking.paidAmount < booking.estimatedTotal
    case 'DP_FULLY_PAID':
      return isFullyPaidByDownPayment(booking)
    case 'DP_EARLY_PENDING':
      return hasPendingEarlyPayment(booking)
    case 'DP_DATE_UNAVAILABLE':
      return booking.status === 'DATE_UNAVAILABLE' && isDownPaymentBooking(booking)
    case 'FP_PENDING':
      return isPendingInitialPayment(booking, true)
    case 'FP_CONFIRMED':
      return booking.status === 'CONFIRMED' &&
        booking.paymentStatus === 'PAID' &&
        isFullPaymentBooking(booking) &&
        receivedPayments(booking)[0]?.amount >= booking.estimatedTotal
    case 'FP_CANCELLED':
      return isFullPaymentBooking(booking) &&
        (booking.status === 'CANCELLED' || (isRejectedInitialPayment(booking, true) && !(
          booking.paymentStatus === 'PAID' && receivedPayments(booking)[0]?.amount >= booking.estimatedTotal
        )))
    case 'FP_DATE_UNAVAILABLE':
      return booking.status === 'DATE_UNAVAILABLE' && isFullPaymentBooking(booking)
  }
}

function queueCount(bookings: Booking[], queue: Queue) {
  return bookings.filter((booking) => queueMatches(booking, queue)).length
}

function queueHeading(queue: Queue) {
  return Object.values(queueTabs).flat().find((item) => item.id === queue)?.label ?? 'All Inquiries'
}

function hasBalance(booking: Booking) {
  return booking.status === 'CONFIRMED' && booking.paidAmount > 0 && booking.paidAmount < booking.estimatedTotal
}

function paymentLabel(booking: Booking) {
  if (booking.paymentStatus === 'PARTIALLY_PAID') return 'Downpayment received'
  if (booking.paymentStatus === 'PAID') return 'Payment verified'
  if (booking.paymentStatus === 'PENDING_REVIEW') return 'Payment proof · review'
  if (booking.paymentStatus === 'NOT_PAID') return 'Not paid'
  if (booking.paymentStatus === 'VOID') return 'Payment void'
  return 'Awaiting payment'
}

function statusLabel(status: BookingStatus) {
  if (status === 'PENDING') return 'Needs review'
  if (status === 'CONFIRMED') return 'Confirmed'
  if (status === 'DATE_UNAVAILABLE') return 'Dates unavailable'
  return 'Cancelled'
}

function balanceDueAt(checkOutDate: string, tourType: Booking['tourType']) {
  const dueTime = tourType === 'DAY_TOUR' ? '16:00:00' : tourType === 'NIGHT_TOUR' ? '05:00:00' : '11:00:00'
  return new Date(`${displayCheckoutDate(checkOutDate, tourType)}T${dueTime}+08:00`)
}

function formatPhilippineDateTime(date: Date) {
  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function PaymentProof({ bookingId, paymentId, token }: { bookingId: string; paymentId: string; token: string }) {
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    let objectUrl = ''
    fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/payments/${encodeURIComponent(paymentId)}/proof`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'Payment proof is no longer available.' : `Could not load payment proof (${response.status}).`)
        return response.blob()
      })
      .then((blob) => {
        if (!blob.type.startsWith('image/')) throw new Error('The payment proof is not a supported image.')
        objectUrl = URL.createObjectURL(blob)
        if (active) setImageUrl(objectUrl)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load payment proof.')
      })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [bookingId, paymentId, token])

  if (error) return <p className="proof-error" role="alert">{error}</p>
  if (!imageUrl) return <p className="proof-loading">Loading private payment proof…</p>
  return <a className="payment-proof-link" href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={`Payment proof for booking ${bookingId}`} /><span>Open screenshot</span></a>
}

function AdminPage() {
  const { user, token, logout } = useAuth()
  const [bookings, setBookings] = useState<Booking[]>([])
  const [queue, setQueue] = useState<Queue>('ALL_INQUIRIES')
  const [queueGroup, setQueueGroup] = useState<QueueGroup>('ALL')
  const [search, setSearch] = useState('')
  const [storageError, setStorageError] = useState('')
  const [activeNav, setActiveNav] = useState('Inquiries')
  const [cashAmounts, setCashAmounts] = useState<Record<string, string>>({})
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!token) return
    let active = true
    const refresh = () => {
      fetchAdminBookings(token)
        .then((result) => {
          if (!active) return
          setBookings(result)
          setStorageError('')
        })
        .catch(async (error: unknown) => {
          if (!active) return
          if (error instanceof Error && error.message.includes('401')) {
            await logout()
            window.location.replace('/login')
            return
          }
          setStorageError(error instanceof Error ? error.message : 'Could not load bookings.')
        })
    }
    refresh()
    const interval = window.setInterval(refresh, 15000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [logout, token])

  const updateBooking = async (
    bookingId: string,
    update: { status: BookingStatus },
  ) => {
    try {
      if (!token) throw new Error('Your sign-in session expired. Please sign in again.')
      await saveBookingReview(token, bookingId, update)
      setBookings(await fetchAdminBookings(token))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not update this booking.')
    }
  }

  const reviewPayment = async (bookingId: string, paymentId: string, received: boolean) => {
    try {
      if (!token) throw new Error('Your sign-in session expired. Please sign in again.')
      await savePaymentReview(token, bookingId, paymentId, received)
      setBookings(await fetchAdminBookings(token))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not review this payment.')
    }
  }

  const recordCash = async (booking: Booking) => {
    const amount = Number(cashAmounts[booking.id])
    try {
      if (!token) throw new Error('Your sign-in session expired. Please sign in again.')
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter the cash amount received.')
      await saveCashPayment(token, booking.id, amount)
      setCashAmounts((current) => ({ ...current, [booking.id]: '' }))
      setBookings(await fetchAdminBookings(token))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not record cash payment.')
    }
  }

  useEffect(() => {
    const updateTime = () => setNow(Date.now())
    updateTime()
    const interval = window.setInterval(updateTime, 60000)
    return () => window.clearInterval(interval)
  }, [])

  const counts = useMemo(() => ({
    allInquiries: queueCount(bookings, 'ALL_INQUIRIES'),
    downPayments: bookings.filter(isDownPaymentBooking).length,
    fullPayments: bookings.filter(isFullPaymentBooking).length,
    overdue: bookings.filter((booking) =>
      hasBalance(booking) &&
      now >= balanceDueAt(booking.checkOutDate, booking.tourType).getTime(),
    ).length,
  }), [bookings, now])

  const visibleBookings = useMemo(() => {
    const query = search.trim().toLowerCase()
    return bookings
      .filter((booking) => queueMatches(booking, queue))
      .filter((booking) =>
        !query || [
          booking.customerName,
          booking.customerContact,
          booking.accommodationName,
          booking.id,
        ].some((value) => value.toLowerCase().includes(query)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [bookings, queue, search])

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/" aria-label="Back to Tampisawan customer page">
          <span className="admin-brand-mark"><Waves size={21} /></span>
          <span><b>TAMPISAWAN</b><small>RESORT ADMIN</small></span>
        </a>
        <div className="admin-sidebar-label">WORKSPACE</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <a className={activeNav === 'Overview' ? 'active' : ''} href="#overview" onClick={() => setActiveNav('Overview')}><LayoutDashboard size={17} /> Overview</a>
          <a className={activeNav === 'Inquiries' ? 'active' : ''} href="#inquiries" onClick={() => { setQueueGroup('ALL'); setQueue('ALL_INQUIRIES'); setActiveNav('Inquiries') }}><ClipboardList size={17} /> Inquiries <span>{counts.allInquiries}</span></a>
          <a className={activeNav === 'Payments' ? 'active' : ''} href="#inquiries" onClick={() => { setQueueGroup('DOWN_PAYMENTS'); setQueue('DP_EARLY_PENDING'); setActiveNav('Payments') }}><CreditCard size={17} /> Payments</a>
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-demo-note"><ShieldAlert size={16} /><span><b>Manual payment review</b><small>Verify each transfer in the payment account before marking it paid.</small></span></div>
          <div className="admin-account"><span><b>{user?.username ?? user?.email}</b><small>Administrator</small></span><button type="button" aria-label="Sign out" onClick={() => logout().then(() => window.location.replace('/login?next=admin')).catch(() => setStorageError('Could not sign out. Please try again.'))}><LogOut size={15} /></button></div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-breadcrumb"><span>Workspace</span><span>/</span><b>{activeNav}</b></div>
          <a href="/" className="customer-link"><ArrowLeft size={15} /> Customer view <ArrowUpRight size={14} /></a>
        </header>

        <div className="admin-content" id="overview">
          <div className="admin-page-heading">
            <div>
              <span className="admin-eyebrow">BOOKING MANAGEMENT</span>
              <h1>Good day, admin.</h1>
              <p>Review stay inquiries, confirm bookings, and verify reported payments.</p>
            </div>
            <span className="today-label"><CalendarDays size={15} /> Today</span>
          </div>

          <div className="admin-demo-banner"><ShieldAlert size={17} /><span><b>Payment review:</b> Verify transfers in the actual account. Cash entries are recorded as received by an admin. Remaining balances are due at least one hour before checkout.</span></div>
          {counts.overdue > 0 && <div className="admin-overdue-banner has-overdue" role="status"><Clock3 size={16} /><b>{counts.overdue} outstanding balance{counts.overdue === 1 ? '' : 's'} past the payment deadline.</b></div>}
          {storageError && <p className="admin-error" role="alert">{storageError}</p>}

          <section className="admin-queue-tabs" aria-label="Inquiry and payment queues">
            <div className="admin-main-tabs" role="tablist" aria-label="Payment type">
              <button type="button" role="tab" aria-selected={queueGroup === 'ALL'} className={queueGroup === 'ALL' ? 'active' : ''} onClick={() => { setQueueGroup('ALL'); setQueue('ALL_INQUIRIES') }}>
                All Inquiries <span>{counts.allInquiries}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'DOWN_PAYMENTS'} className={queueGroup === 'DOWN_PAYMENTS' ? 'active' : ''} onClick={() => { setQueueGroup('DOWN_PAYMENTS'); setQueue('DP_PENDING') }}>
                DownPayments <span>{counts.downPayments}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'FULL_PAYMENT'} className={queueGroup === 'FULL_PAYMENT' ? 'active' : ''} onClick={() => { setQueueGroup('FULL_PAYMENT'); setQueue('FP_PENDING') }}>
                Full Payment <span>{counts.fullPayments}</span>
              </button>
            </div>
            {queueGroup !== 'ALL' && (
              <div className="admin-sub-tabs" role="tablist" aria-label={queueGroup === 'DOWN_PAYMENTS' ? 'Downpayment statuses' : 'Full payment statuses'}>
                {queueTabs[queueGroup].map((item) => (
                  <button type="button" role="tab" aria-selected={queue === item.id} className={queue === item.id ? 'active' : ''} key={item.id} onClick={() => setQueue(item.id)}>
                    {item.label}<span>{queueCount(bookings, item.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="inquiries-panel" id="inquiries">
            <div className="inquiries-heading">
              <div><h2>{queueHeading(queue)}</h2><p>{queue === 'ALL_INQUIRIES' ? 'Only pending inquiries awaiting initial payment verification appear here.' : queue === 'DP_PENDING' ? 'Downpayment proofs awaiting admin verification.' : queue === 'DP_SUCCESSFUL' ? 'Downpayments confirmed as received by an admin.' : queue === 'DP_CANCELLED' ? 'Downpayment bookings cancelled by the admin.' : queue === 'DP_NOT_RECEIVED' ? 'Downpayments the admin marked as not received.' : queue === 'DP_PAID' ? 'Confirmed downpayments with an outstanding balance.' : queue === 'DP_FULLY_PAID' ? 'Downpayment bookings whose later payments cleared the full balance.' : queue === 'DP_EARLY_PENDING' ? 'Early or remaining-balance payment proofs awaiting verification.' : queue === 'DP_DATE_UNAVAILABLE' || queue === 'FP_DATE_UNAVAILABLE' ? 'Payment was received after another booking secured these dates. Contact the customer to arrange a refund or discuss alternatives.' : queue === 'FP_PENDING' ? 'Full-payment proofs awaiting admin verification.' : queue === 'FP_CONFIRMED' ? 'Initial full payments confirmed as received by an admin.' : 'Full-payment bookings cancelled or marked not received.'}</p></div>
              <div className="inquiry-search"><Search size={16} /><input aria-label="Search inquiries" placeholder="Search name, stay, or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            </div>
            {visibleBookings.length === 0 ? (
              <div className="admin-empty">
                <span><ClipboardList size={23} /></span>
                <b>{bookings.length === 0 ? 'No inquiries yet' : `No ${queueHeading(queue).toLowerCase()} to show`}</b>
                <p>{bookings.length === 0 ? 'Customer requests submitted from the customer website will appear here.' : 'Items will appear here when their booking or payment reaches this stage.'}</p>
                {bookings.length === 0 && <a href="/">Open the customer page <ArrowUpRight size={14} /></a>}
              </div>
            ) : (
              <div className="booking-list">
                {visibleBookings.map((booking) => (
                  <article className="admin-booking-card" key={booking.id}>
                    <div className="admin-booking-top">
                      <div className="admin-customer">
                        <span className="customer-avatar">{booking.customerName.trim().charAt(0).toUpperCase()}</span>
                        <span><b>{booking.customerName}</b><small>{booking.customerContact}</small></span>
                      </div>
                      <div className="booking-badges">
                        <span className={`status-badge status-${booking.status.toLowerCase()}`}>{statusLabel(booking.status)}</span>
                        <span className={`payment-badge payment-${booking.paymentStatus.toLowerCase()}`}><CircleDollarSign size={12} /> {paymentLabel(booking)}</span>
                      </div>
                    </div>
                    <div className="admin-booking-details">
                      <div><small>REFERENCE</small><b>{booking.id}</b></div>
                      <div><small>{tourDetails[booking.tourType].label.toUpperCase()}</small><b>{booking.accommodationName}</b></div>
                      <div><small>CHECK-IN</small><b>{new Date(`${booking.checkInDate}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} · {tourDetails[booking.tourType].checkIn}</b></div>
                      <div><small>{booking.tourType === 'DAY_TOUR' ? 'LAST TOUR DAY' : 'CHECK-OUT'}</small><b>{new Date(`${displayCheckoutDate(booking.checkOutDate, booking.tourType)}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })} · {tourDetails[booking.tourType].checkOut}</b></div>
                      <div><small>GUESTS</small><b><Users size={13} /> {booking.guestCount}</b></div>
                      <div><small>TOTAL / RECEIVED</small><b>{formatPeso(booking.estimatedTotal)} / {formatPeso(booking.paidAmount)}</b></div>
                    </div>
                    <div className="payment-history">
                      <b>Payment history</b>
                      {booking.payments.length === 0 ? <small>No payment activity recorded.</small> : booking.payments.map((payment) => (
                        <div className="payment-history-entry" key={payment.id}>
                          <div>
                            <b>{formatPeso(payment.amount)} · {payment.method === 'CASH' ? 'Cash' : payment.method.replace('_', ' ')}</b>
                            <span>{payment.source === 'ADMIN_CASH' ? 'Received as cash by admin' : payment.reference ? `Reference ${payment.reference}` : 'Customer-reported transfer'}</span>
                            {payment.payerAccount && <span>Payer account: {payment.payerAccount}</span>}
                            <small>{new Date(payment.submittedAt).toLocaleString('en-PH')}{payment.verifiedAt ? ` · ${payment.status === 'RECEIVED' ? 'Verified' : 'Reviewed'} ${new Date(payment.verifiedAt).toLocaleString('en-PH')}` : ''}</small>
                          </div>
                          <span className={`payment-history-status history-${payment.status.toLowerCase()}`}>{payment.status === 'PENDING_REVIEW' ? 'Needs verification' : payment.status === 'RECEIVED' ? 'Received' : 'Not received'}</span>
                          {payment.hasProof && <PaymentProof bookingId={booking.id} paymentId={payment.id} token={token ?? ''} />}
                          {payment.status === 'PENDING_REVIEW' && booking.status !== 'CANCELLED' && booking.status !== 'DATE_UNAVAILABLE' && (
                            <div className="payment-review-actions">
                              <button className="action-confirm" type="button" onClick={() => reviewPayment(booking.id, payment.id, true)}><CheckCheck size={13} /> Confirm received</button>
                              <button className="action-decline" type="button" onClick={() => reviewPayment(booking.id, payment.id, false)}><X size={13} /> Not received</button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {booking.paidAmount > 0 && booking.paidAmount < booking.estimatedTotal && (
                      <div className={`balance-deadline ${now >= balanceDueAt(booking.checkOutDate, booking.tourType).getTime() ? 'is-overdue' : ''}`}>
                        <Clock3 size={15} />
                        <span><b>{now >= balanceDueAt(booking.checkOutDate, booking.tourType).getTime() ? 'Balance overdue' : 'Balance due'}</b>
                          <small>{formatPeso(booking.estimatedTotal - booking.paidAmount)} by {formatPhilippineDateTime(balanceDueAt(booking.checkOutDate, booking.tourType))} (at least 1 hour before checkout)</small>
                        </span>
                      </div>
                    )}
                    <div className="admin-booking-actions">
                      {booking.status === 'DATE_UNAVAILABLE' ? (
                        <div className="admin-date-conflict" role="alert">
                          <ShieldAlert size={15} />
                          <span><b>Payment received, dates already secured</b><small>Contact the customer to arrange a refund or discuss alternative dates.</small></span>
                        </div>
                      ) : booking.status === 'CANCELLED' ? (
                        <span className="action-hint">Booking cancelled by admin.</span>
                      ) : (
                        <>
                          <span className="action-hint">{booking.paymentStatus === 'PAID' ? 'Full payment received. Booking successful.' : booking.paymentStatus === 'PENDING_REVIEW' ? 'Payment proof is waiting for verification. Review it before recording any cash.' : booking.status === 'PENDING' ? 'Waiting for initial payment approval.' : 'Customer may pay the balance early or before the deadline.'}</span>
                          {booking.paymentStatus !== 'PAID' && booking.paymentStatus !== 'PENDING_REVIEW' && (
                            <div className="admin-cash-entry">
                              <label htmlFor={`cash-${booking.id}`}>Cash received</label>
                              <input id={`cash-${booking.id}`} type="number" min={booking.paidAmount > 0 ? '0.01' : booking.depositRequired} max={booking.estimatedTotal - booking.paidAmount} step="0.01" value={cashAmounts[booking.id] ?? ''} onChange={(event) => setCashAmounts((current) => ({ ...current, [booking.id]: event.target.value }))} placeholder="Amount" />
                              <button className="action-confirm" type="button" onClick={() => recordCash(booking)}>Record cash</button>
                            </div>
                          )}
                          {booking.paymentStatus !== 'PAID' && <button className="action-decline" type="button" onClick={() => updateBooking(booking.id, { status: 'CANCELLED' })}><X size={14} /> Cancel</button>}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          <footer className="admin-footer"><span>Tampisawan admin workspace · PostgreSQL bookings</span><a href="/">Back to customer website <ArrowUpRight size={13} /></a></footer>
        </div>
      </main>
    </div>
  )
}

export default AdminPage
