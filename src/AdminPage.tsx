import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  CheckCheck,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  CreditCard,
  LineChart,
  FileText,
  Hourglass,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  ShieldAlert,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import {
  type Booking,
  type BookingStatus,
  displayCheckoutDate,
  formatHoldTimeLeft,
  holdMillisecondsLeft,
  tourDetails,
} from './data/bookings'
import { accommodations } from './data/accommodations'
import {
  confirmHoldWithCash as saveHoldCashConfirmation,
  createWalkInCashBooking as saveWalkInCashBooking,
  fetchAdminBookings,
  recordCashPayment as saveCashPayment,
  reviewPayment as savePaymentReview,
  updateBookingReview as saveBookingReview,
} from './api/bookings'
import { BOOKING_MAX_GUESTS, calculateBookingTotal, formatPeso, priceAccommodations } from './utils/pricing'
import { useAuth } from './auth/useAuth'
import BookingReceiptModal from './BookingReceiptModal'
import EarningsDashboard from './EarningsDashboard'
import ResortLogo from './components/ResortLogo'
import AdminUsersTab from './AdminUsersTab'
import { BlockDatesModal, RescheduleModal } from './AdminOperationsModals'
import { type AdminUser, fetchAdminUsers } from './api/admin'
import './AdminPage.css'

type Queue =
  | 'ALL_INQUIRIES'
  | 'DP_TO_VERIFY'
  | 'DP_BALANCE_DUE'
  | 'DP_REFUND'
  | 'FP_PENDING'
  | 'FP_CONFIRMED'
  | 'FP_CANCELLED'
  | 'FP_DATE_UNAVAILABLE'
  | 'CASH_WALKIN'
  | 'HOLD_ACTIVE'
  | 'HOLD_CONFIRMED'
  | 'HOLD_EXPIRED'
  | 'HOLD_SUPERSEDED'
  | 'HOLD_CANCELLED'

type QueueGroup = 'ALL' | 'HOLDS' | 'DOWN_PAYMENTS' | 'FULL_PAYMENT' | 'WALKIN_CASH'

const queueTabs: Record<QueueGroup, { id: Queue; label: string }[]> = {
  ALL: [{ id: 'ALL_INQUIRIES', label: 'All Inquiries' }],
  HOLDS: [
    { id: 'HOLD_ACTIVE', label: 'Active 24-hr holds' },
    { id: 'HOLD_CONFIRMED', label: 'Confirmed · cash paid' },
    { id: 'HOLD_EXPIRED', label: 'Expired' },
    { id: 'HOLD_SUPERSEDED', label: 'Released · confirmed for another guest' },
    { id: 'HOLD_CANCELLED', label: 'Cancelled by admin' },
  ],
  DOWN_PAYMENTS: [
    // Only what still needs the admin. Completed downpayments are in the Earnings records.
    { id: 'DP_TO_VERIFY', label: 'To verify' },
    { id: 'DP_BALANCE_DUE', label: 'Balance due' },
    { id: 'DP_REFUND', label: 'Refund follow-up' },
  ],
  FULL_PAYMENT: [
    { id: 'FP_PENDING', label: 'Pending Full Payment' },
    { id: 'FP_CONFIRMED', label: 'Confirmed' },
    { id: 'FP_CANCELLED', label: 'Cancelled Full Payment' },
    { id: 'FP_DATE_UNAVAILABLE', label: 'Date unavailable · follow-up' },
  ],
  WALKIN_CASH: [{ id: 'CASH_WALKIN', label: 'Walk-In Cash' }],
}

const wholeResortAccommodationIds = new Set(
  accommodations.filter((accommodation) => accommodation.exclusiveWholeResort).map((accommodation) => accommodation.id),
)

function todayInManila() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}

function nextDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
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
  if (booking.paymentTier === 'WALKIN_CASH_NO_RESERVATION') return false
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

function hasPaymentToVerify(booking: Booking) {
  return booking.payments.some((payment) => payment.status === 'PENDING_REVIEW')
}

function queueMatches(booking: Booking, queue: Queue) {
  switch (queue) {
    case 'ALL_INQUIRIES':
      return booking.status === 'PENDING' || booking.status === 'PENDING_HOLD'
    case 'HOLD_ACTIVE':
      return booking.status === 'PENDING_HOLD'
    case 'HOLD_CONFIRMED':
      // A hold the admin confirmed with cash keeps its original TRP-HOLD reference.
      return Boolean(booking.holdReferenceNumber)
    case 'HOLD_EXPIRED':
      return booking.status === 'EXPIRED'
    case 'HOLD_SUPERSEDED':
      return booking.status === 'CANCELLED_BY_GCASH_PRIORITY'
    case 'HOLD_CANCELLED':
      return booking.paymentTier === 'PENDING_CASH_INQUIRY' && booking.status === 'CANCELLED'
    case 'DP_TO_VERIFY':
      // A downpayment or a later balance payment is waiting for the admin to confirm it.
      return isDownPaymentBooking(booking) &&
        booking.status !== 'CANCELLED' && booking.status !== 'DATE_UNAVAILABLE' &&
        hasPaymentToVerify(booking)
    case 'DP_BALANCE_DUE':
      // Confirmed stay with cash still to collect (nothing waiting for verification).
      return isDownPaymentBooking(booking) && booking.status === 'CONFIRMED' &&
        booking.paidAmount > 0 && booking.paidAmount < booking.estimatedTotal &&
        !hasPaymentToVerify(booking)
    case 'DP_REFUND':
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
    case 'CASH_WALKIN':
      // Same-day walk-ins only; confirmed holds are listed under 24-Hr Holds.
      return booking.paymentTier === 'WALKIN_CASH_NO_RESERVATION' && !booking.holdReferenceNumber
  }
}

function queueCount(bookings: Booking[], queue: Queue) {
  return bookings.filter((booking) => queueMatches(booking, queue)).length
}

/** A main tab's badge: the distinct bookings listed in any of its sub-tabs, so the numbers always agree. */
function groupCount(bookings: Booking[], group: QueueGroup) {
  return bookings.filter((booking) => queueTabs[group].some((tab) => queueMatches(booking, tab.id))).length
}

function queueHeading(queue: Queue) {
  return Object.values(queueTabs).flat().find((item) => item.id === queue)?.label ?? 'All Inquiries'
}

/** Priority rank for sorting: 1 GCash / confirmed cash, 2 pending holds, legacy rows last. */
function sortRank(booking: Booking) {
  return booking.priorityRank ?? 3
}

function hasBalance(booking: Booking) {
  return booking.status === 'CONFIRMED' && booking.paidAmount > 0 && booking.paidAmount < booking.estimatedTotal
}

function paymentLabel(booking: Booking) {
  if (booking.paymentStatus === 'PAID_CASH') return 'Walk-in · cash paid'
  if (booking.paymentStatus === 'PARTIALLY_PAID') return 'Downpayment received'
  if (booking.paymentStatus === 'PAID') return 'Payment verified'
  if (booking.paymentStatus === 'PENDING_REVIEW') return 'Payment proof · review'
  if (booking.paymentStatus === 'NOT_PAID') return 'Not paid'
  if (booking.paymentStatus === 'VOID') return 'Payment void'
  return 'Awaiting payment'
}

function statusLabel(status: BookingStatus) {
  if (status === 'PENDING') return 'Needs review'
  if (status === 'PENDING_HOLD') return '24-HR HEADS-UP HOLD'
  if (status === 'EXPIRED') return 'EXPIRED'
  if (status === 'CANCELLED_BY_GCASH_PRIORITY') return 'Released · confirmed for another guest'
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
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [walkInName, setWalkInName] = useState('')
  const [walkInEmail, setWalkInEmail] = useState('')
  const [walkInAccommodationIds, setWalkInAccommodationIds] = useState<string[]>([accommodations[0].id])
  const [walkInTourType, setWalkInTourType] = useState<Booking['tourType']>('DAY_TOUR')
  const [walkInCheckIn, setWalkInCheckIn] = useState(todayInManila)
  const [walkInCheckOut, setWalkInCheckOut] = useState(() => nextDate(todayInManila()))
  const [walkInGuests, setWalkInGuests] = useState({ adults: 2, seniorsPwd: 0, children: 0 })
  const [walkInSubmitting, setWalkInSubmitting] = useState(false)
  const [walkInError, setWalkInError] = useState('')
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null)
  const [confirmingHoldId, setConfirmingHoldId] = useState('')
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [usersError, setUsersError] = useState('')
  const [showBlockDates, setShowBlockDates] = useState(false)
  const [rescheduleTarget, setRescheduleTarget] = useState<Booking | null>(null)
  const [opsNotice, setOpsNotice] = useState('')

  const loadUsers = useCallback(async () => {
    if (!token) return
    try {
      setAdminUsers(await fetchAdminUsers(token))
      setUsersError('')
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Could not load users.')
    } finally {
      setUsersLoading(false)
    }
  }, [token])

  const refreshBookings = useCallback(async () => {
    if (!token) return
    try {
      setBookings(await fetchAdminBookings(token))
    } catch {
      // The 15-second refresh will retry and show any error.
    }
  }, [token])

  // Users (and their booking counts) load once for the sidebar badge, and again whenever the
  // Users tab is opened.
  useEffect(() => {
    if (!token) return
    let active = true
    fetchAdminUsers(token)
      .then((result) => {
        if (!active) return
        setAdminUsers(result)
        setUsersError('')
      })
      .catch((error: unknown) => {
        if (active) setUsersError(error instanceof Error ? error.message : 'Could not load users.')
      })
      .finally(() => {
        if (active) setUsersLoading(false)
      })
    return () => { active = false }
  }, [token, activeNav])

  // A walk-in can combine several accommodations, like an online booking.
  const toggleWalkInAccommodation = (id: string) => {
    if (walkInAccommodationIds.length === 1 && walkInAccommodationIds[0] === id) return
    const next = walkInAccommodationIds.includes(id)
      ? walkInAccommodationIds.filter((current) => current !== id)
      : [...walkInAccommodationIds, id]
    setWalkInAccommodationIds(accommodations.filter((accommodation) => next.includes(accommodation.id)).map((accommodation) => accommodation.id))
  }
  const walkInDays = Math.max(1, Math.round(
    (Date.parse(`${walkInCheckOut}T00:00:00.000Z`) - Date.parse(`${walkInCheckIn}T00:00:00.000Z`)) / 86_400_000,
  ))
  // Rates and maximum pax for this tour type and length (2+ days: overnight rates).
  const walkInPricedStays = priceAccommodations(accommodations, walkInTourType, walkInDays)
  const walkInAccommodations = walkInPricedStays.filter((accommodation) => walkInAccommodationIds.includes(accommodation.id))
  const walkInRoomPax = walkInAccommodations.reduce((sum, accommodation) => sum + accommodation.capacity, 0)
  const walkInGuestLimit = BOOKING_MAX_GUESTS
  const walkInTotal = calculateBookingTotal(
    walkInAccommodations,
    walkInGuests,
    walkInDays,
    walkInTourType,
  ).grandTotal

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

  /** Cancelling releases the booking's dates; say so, and what happens to money already received. */
  const cancelBooking = (booking: Booking) => {
    const isHold = booking.status === 'PENDING_HOLD'
    const received = booking.paidAmount > 0
      ? `\n\n${formatPeso(booking.paidAmount)} already received will move to "Held for refund review" on the Earnings page.`
      : ''
    const confirmed = window.confirm(
      `Cancel ${isHold ? 'this 24-hour hold' : 'this booking'} for ${booking.customerName} (${booking.accommodationName}, ${booking.checkInDate})?\n\nThe dates become available to other guests right away.${received}`,
    )
    if (confirmed) void updateBooking(booking.id, { status: 'CANCELLED' })
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

  const confirmHoldCash = async (booking: Booking) => {
    const confirmed = window.confirm(
      `Confirm that ${booking.customerName} paid ${formatPeso(booking.baseResortPrice)} in cash for ${booking.accommodationName}? This converts the 24-hour hold into a confirmed cash booking.`,
    )
    if (!confirmed) return
    setConfirmingHoldId(booking.id)
    try {
      if (!token) throw new Error('Your sign-in session expired. Please sign in again.')
      await saveHoldCashConfirmation(token, booking.id)
      setBookings(await fetchAdminBookings(token))
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not confirm this hold.')
      try {
        if (token) setBookings(await fetchAdminBookings(token))
      } catch {
        // Keep the current list; the error above is already shown.
      }
    } finally {
      setConfirmingHoldId('')
    }
  }

  const submitWalkIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!token) {
      setWalkInError('Your sign-in session expired. Please sign in again.')
      return
    }
    setWalkInSubmitting(true)
    setWalkInError('')
    try {
      const created = await saveWalkInCashBooking(token, {
        customerName: walkInName.trim(),
        customerEmail: walkInEmail.trim(),
        accommodationIds: walkInAccommodations.map((accommodation) => accommodation.id),
        tourType: walkInTourType,
        checkInDate: walkInCheckIn,
        checkOutDate: walkInCheckOut,
        guests: { ...walkInGuests },
      })
      const updatedBookings = await fetchAdminBookings(token)
      setBookings(updatedBookings)
      const createdBooking = updatedBookings.find((booking) => booking.referenceNumber === created.referenceNumber)
      if (createdBooking) setReceiptBooking(createdBooking)
      setShowWalkIn(false)
      setWalkInName('')
      setWalkInEmail('')
      setWalkInAccommodationIds([accommodations[0].id])
      setWalkInTourType('DAY_TOUR')
      setWalkInCheckIn(todayInManila())
      setWalkInCheckOut(nextDate(todayInManila()))
      setWalkInGuests({ adults: 2, seniorsPwd: 0, children: 0 })
      setStorageError('')
    } catch (error) {
      setWalkInError(error instanceof Error ? error.message : 'Could not log the walk-in booking.')
    } finally {
      setWalkInSubmitting(false)
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
    activeHolds: queueCount(bookings, 'HOLD_ACTIVE'),
    holds: groupCount(bookings, 'HOLDS'),
    walkIns: groupCount(bookings, 'WALKIN_CASH'),
    downPayments: groupCount(bookings, 'DOWN_PAYMENTS'),
    fullPayments: groupCount(bookings, 'FULL_PAYMENT'),
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
          booking.referenceNumber,
          booking.gatewayPaymentId ?? '',
        ].some((value) => value.toLowerCase().includes(query)),
      )
      // Priority #1 (GCash / confirmed) before Priority #2 (24-hr holds), then by check-in date.
      .sort((a, b) =>
        sortRank(a) - sortRank(b) ||
        a.checkInDate.localeCompare(b.checkInDate) ||
        b.createdAt.localeCompare(a.createdAt))
  }, [bookings, queue, search])

  const nextHoldExpiry = useMemo(() => bookings
    .filter((booking) => booking.status === 'PENDING_HOLD' && booking.expiresAt)
    .map((booking) => Date.parse(booking.expiresAt ?? ''))
    .filter((time) => time > now)
    .sort((a, b) => a - b)[0], [bookings, now])

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <a className="admin-brand admin-brand-logo" href="/" aria-label="Back to Tampisawan customer page">
          <ResortLogo className="resort-logo-admin" />
          <small>RESORT ADMIN</small>
        </a>
        <div className="admin-sidebar-label">WORKSPACE</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          <a className={activeNav === 'Overview' ? 'active' : ''} href="#overview" onClick={() => setActiveNav('Overview')}><LayoutDashboard size={17} /> Overview</a>
          <a className={activeNav === 'Inquiries' ? 'active' : ''} href="#inquiries" onClick={() => { setQueueGroup('ALL'); setQueue('ALL_INQUIRIES'); setActiveNav('Inquiries') }}><ClipboardList size={17} /> Inquiries <span>{counts.allInquiries}</span></a>
          <a className={activeNav === 'Payments' ? 'active' : ''} href="#inquiries" onClick={() => { setQueueGroup('DOWN_PAYMENTS'); setQueue('DP_TO_VERIFY'); setActiveNav('Payments') }}><CreditCard size={17} /> Payments</a>
          <a className={activeNav === 'Earnings' ? 'active' : ''} href='#earnings' onClick={() => setActiveNav('Earnings')}><LineChart size={17} /> Earnings</a>
          <a className={activeNav === 'Users' ? 'active' : ''} href='#users' onClick={() => setActiveNav('Users')}><Users size={17} /> Users <span>{adminUsers.length}</span></a>
        </nav>
        <div className="admin-sidebar-bottom">
          <div className="admin-demo-note"><ShieldAlert size={16} /><span><b>Payment controls</b><small>Online GCash is confirmed by HitPay’s signed webhook. Record cash only after collection.</small></span></div>
          <div className="admin-account"><span><b>{user?.username ?? user?.email}</b><small>Administrator</small></span><button type="button" aria-label="Sign out" onClick={() => logout().then(() => window.location.replace('/login?next=admin')).catch(() => setStorageError('Could not sign out. Please try again.'))}><LogOut size={15} /></button></div>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div className="admin-breadcrumb"><span>Workspace</span><span>/</span><b>{activeNav}</b></div>
          <a href="/" className="customer-link"><ArrowLeft size={15} /> Customer view <ArrowUpRight size={14} /></a>
        </header>

        <div className="admin-content" id="overview">
          {activeNav === 'Earnings' ? (
            <EarningsDashboard bookings={bookings} preparedBy={user?.name || user?.username || 'Administrator'} />
          ) : activeNav === 'Users' && token ? (
            <AdminUsersTab
              users={adminUsers}
              loading={usersLoading}
              error={usersError}
              token={token}
              currentUserId={user?.id}
              onChanged={async () => { await Promise.all([loadUsers(), refreshBookings()]) }}
            />
          ) : (<>
          <div className="admin-page-heading">
            <div>
              <span className="admin-eyebrow">BOOKING MANAGEMENT</span>
              <h1>Good day, admin.</h1>
              <p>Review stay inquiries, monitor payment tiers, and record same-day cash walk-ins.</p>
            </div>
            <div className="admin-heading-actions">
              <button type="button" className="ops-block-button" onClick={() => { setOpsNotice(''); setShowBlockDates(true) }}>
                <CalendarOff size={15} /> Block Dates / Maintenance
              </button>
              <button type="button" className="walkin-new-booking-button" onClick={() => { setWalkInError(''); setShowWalkIn(true) }}>
                <Plus size={15} /> Log Walk-In Cash Booking
              </button>
              <span className="today-label"><CalendarDays size={15} /> Today</span>
            </div>
          </div>

          <div className="admin-demo-banner"><ShieldAlert size={17} /><span><b>First come, first served:</b> dates stay open until a booking is confirmed, by a verified GCash deposit, cash you record, a walk-in, or a verified payment proof. Inquiries and 24-hour holds don't reserve dates; when a booking is confirmed, overlapping holds are released automatically.</span></div>
          {counts.activeHolds > 0 && (
            <button type="button" className="admin-hold-banner" onClick={() => { setQueueGroup('HOLDS'); setQueue('HOLD_ACTIVE'); setActiveNav('Inquiries') }}>
              <Hourglass size={16} />
              <span><b>{counts.activeHolds} pending heads-up hold{counts.activeHolds === 1 ? '' : 's'}</b>{nextHoldExpiry ? ` · next expires in ${formatHoldTimeLeft(nextHoldExpiry - now)}` : ''}. Holds don't reserve dates: the first booking confirmed gets them.</span>
            </button>
          )}
          {counts.overdue > 0 && <div className="admin-overdue-banner has-overdue" role="status"><Clock3 size={16} /><b>{counts.overdue} outstanding balance{counts.overdue === 1 ? '' : 's'} past the payment deadline.</b></div>}
          {storageError && <p className="admin-error" role="alert">{storageError}</p>}
          {opsNotice && (
            <p className="ops-notice ops-notice-banner" role="status">
              {opsNotice}
              <button type="button" aria-label="Dismiss" onClick={() => setOpsNotice('')}><X size={13} /></button>
            </p>
          )}

          <section className="admin-queue-tabs" aria-label="Inquiry and payment queues">
            <div className="admin-main-tabs" role="tablist" aria-label="Payment type">
              <button type="button" role="tab" aria-selected={queueGroup === 'ALL'} className={queueGroup === 'ALL' ? 'active' : ''} onClick={() => { setQueueGroup('ALL'); setQueue('ALL_INQUIRIES') }}>
                All Inquiries <span>{counts.allInquiries}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'HOLDS'} className={queueGroup === 'HOLDS' ? 'active' : ''} onClick={() => { setQueueGroup('HOLDS'); setQueue('HOLD_ACTIVE') }}>
                24-Hr Holds <span>{counts.holds}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'DOWN_PAYMENTS'} className={queueGroup === 'DOWN_PAYMENTS' ? 'active' : ''} onClick={() => { setQueueGroup('DOWN_PAYMENTS'); setQueue('DP_TO_VERIFY') }}>
                DownPayments <span>{counts.downPayments}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'FULL_PAYMENT'} className={queueGroup === 'FULL_PAYMENT' ? 'active' : ''} onClick={() => { setQueueGroup('FULL_PAYMENT'); setQueue('FP_PENDING') }}>
                Full Payment <span>{counts.fullPayments}</span>
              </button>
              <button type="button" role="tab" aria-selected={queueGroup === 'WALKIN_CASH'} className={queueGroup === 'WALKIN_CASH' ? 'active' : ''} onClick={() => { setQueueGroup('WALKIN_CASH'); setQueue('CASH_WALKIN'); setActiveNav('Payments') }}>
                Walk-In Cash <span>{counts.walkIns}</span>
              </button>
            </div>
            {queueGroup !== 'ALL' && (
              <div className="admin-sub-tabs" role="tablist" aria-label={queueGroup === 'DOWN_PAYMENTS' ? 'Downpayment statuses' : queueGroup === 'WALKIN_CASH' ? 'Walk-in bookings' : queueGroup === 'HOLDS' ? 'Pending hold statuses' : 'Full payment statuses'}>
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
              <div><h2>{queueHeading(queue)}</h2><p>{queue === 'ALL_INQUIRIES' ? 'Pending inquiries and 24-hour cash holds, with Priority #1 GCash reservations first, then by check-in date.' : queue === 'HOLD_ACTIVE' ? 'Heads-up holds from guests planning to pay cash. They do not reserve the dates: several guests may hold the same dates, and the first booking confirmed gets them. Holds expire after 24 hours.' : queue === 'HOLD_CONFIRMED' ? 'Holds whose guests paid the full rate in cash before the 24 hours ran out. Each now has a TRP-CASH reference.' : queue === 'HOLD_CANCELLED' ? 'Holds cancelled by an admin before payment. Their dates were released.' : queue === 'HOLD_EXPIRED' ? 'Holds that passed 24 hours without payment. Their dates were released.' : queue === 'HOLD_SUPERSEDED' ? 'Unpaid holds released automatically because another booking for the same dates was confirmed first (GCash deposit, cash, walk-in, or verified payment).' : queue === 'CASH_WALKIN' ? 'Same-day walk-ins confirmed after full cash payment; gateway fees are zero. Confirmed cash holds are under 24-Hr Holds.' : queue === 'DP_TO_VERIFY' ? 'Downpayment and balance payment proofs waiting for you to confirm they were received.' : queue === 'DP_BALANCE_DUE' ? 'Confirmed stays with a cash balance still to collect, earliest check-in first. Record the cash when you receive it.' : queue === 'DP_REFUND' || queue === 'FP_DATE_UNAVAILABLE' ? 'Payment was received after another booking secured these dates. Contact the customer to arrange a refund or discuss alternatives.' : queue === 'FP_PENDING' ? 'Full-payment proofs awaiting admin verification.' : queue === 'FP_CONFIRMED' ? 'Initial full payments confirmed as received by an admin.' : 'Full-payment bookings cancelled or marked not received.'}</p></div>
              <div className="inquiry-search"><Search size={16} /><input aria-label="Search inquiries" placeholder="Search name, stay, or reference" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            </div>
            {visibleBookings.length === 0 ? (
              <div className="admin-empty">
                <span><ClipboardList size={23} /></span>
                <b>{bookings.length === 0 ? 'No inquiries yet' : `Nothing in “${queueHeading(queue)}” right now`}</b>
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
                        {booking.status === 'PENDING_HOLD' ? (() => {
                          const left = holdMillisecondsLeft(booking.expiresAt, now)
                          return left > 0 ? (
                            <>
                              <span className="status-badge status-pending_hold"><Hourglass size={12} /> 24-HR HEADS-UP HOLD</span>
                              <span className="hold-expiry-badge">Expires in {formatHoldTimeLeft(left)}</span>
                            </>
                          ) : <span className="status-badge status-expired">EXPIRED</span>
                        })() : (
                          <span className={`status-badge status-${booking.status.toLowerCase()}`}>{statusLabel(booking.status)}</span>
                        )}
                        {booking.paymentTier !== 'PENDING_CASH_INQUIRY' && (
                          <span className={`payment-badge payment-${booking.paymentStatus.toLowerCase()}`}><CircleDollarSign size={12} /> {paymentLabel(booking)}</span>
                        )}
                      </div>
                    </div>
                    <div className="admin-booking-details">
                      <div><small>REFERENCE NO.</small><b>{booking.referenceNumber}</b></div>
                      <div><small>PAYMENT TIER</small><b>{booking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? '1 · GCash reservation' : booking.paymentTier === 'WALKIN_CASH_NO_RESERVATION' ? booking.holdReferenceNumber ? `Cash · from hold ${booking.holdReferenceNumber}` : '2 · Walk-in cash' : booking.paymentTier === 'PENDING_CASH_INQUIRY' ? '2 · 24-hr pending cash hold' : 'Manual / legacy'}</b></div>
                      <div><small>NET RESORT EARNINGS</small><b>{formatPeso(booking.baseResortPrice)}</b></div>
                      <div><small>SEPARATED GATEWAY FEE</small><b>{formatPeso(booking.gatewayFeeAmount)}</b></div>
                      <div><small>HITPAY TXN ID</small><b>{booking.gatewayPaymentId ?? '—'}</b></div>
                      <div>
                        <small>{tourDetails[booking.tourType].label.toUpperCase()}</small>
                        <b>{booking.accommodationName}</b>
                        {booking.accommodationIds.some((id) => wholeResortAccommodationIds.has(id)) ? (
                          <small className="admin-booking-exclusive">
                            {booking.status === 'CONFIRMED'
                              ? '✨ Exclusive Whole Resort'
                              : booking.status === 'DATE_UNAVAILABLE'
                                ? 'Whole-resort dates unavailable'
                                : booking.status === 'CANCELLED'
                                  ? 'Whole-resort booking cancelled'
                                  : '✨ Exclusive Whole Resort (on confirmation)'}
                          </small>
                        ) : (
                          <small className="admin-booking-shared">
                            Standard shared-pool access
                          </small>
                        )}
                      </div>
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
                      <button className="admin-receipt-button" type="button" onClick={() => setReceiptBooking(booking)}><FileText size={14} /> View Receipt</button>
                      {booking.status === 'PENDING_HOLD' ? (
                        holdMillisecondsLeft(booking.expiresAt, now) > 0 ? (
                          <>
                            <span className="action-hint">Guest plans to pay {formatPeso(booking.baseResortPrice)} in cash. Confirm only after collecting it.</span>
                            <button className="action-confirm hold-confirm-button" type="button" disabled={confirmingHoldId === booking.id} onClick={() => confirmHoldCash(booking)}>
                              <CheckCheck size={14} /> {confirmingHoldId === booking.id ? 'Confirming…' : 'Mark Cash Paid & Confirm'}
                            </button>
                            <button className="action-decline" type="button" onClick={() => cancelBooking(booking)}><X size={14} /> Cancel hold</button>
                          </>
                        ) : (
                          <span className="action-hint">This hold passed 24 hours without payment and is being released.</span>
                        )
                      ) : booking.status === 'EXPIRED' ? (
                        <span className="action-hint">Hold expired after 24 hours without payment. The dates were released.</span>
                      ) : booking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? (
                        <span className="action-hint">Released automatically: another booking for these dates was confirmed first.</span>
                      ) : booking.status === 'DATE_UNAVAILABLE' ? (
                        <div className="admin-date-conflict" role="alert">
                          <ShieldAlert size={15} />
                          <span><b>Payment received, dates already secured</b><small>Contact the customer to arrange a refund or discuss alternative dates.</small></span>
                        </div>
                      ) : booking.status === 'CANCELLED' ? (
                        <span className="action-hint">Booking cancelled by admin.</span>
                      ) : (
                        <>
                          <span className="action-hint">{booking.paymentStatus === 'PAID_CASH' ? 'Walk-in cash received in full; booking confirmed.' : booking.paymentStatus === 'PAID' ? 'Full payment received. Booking successful.' : booking.paymentStatus === 'PENDING_REVIEW' ? 'Payment proof is waiting for verification. Review it before recording any cash.' : booking.status === 'PENDING' ? 'Waiting for initial payment approval.' : 'The remaining base balance is collected in cash at check-in.'}</span>
                          {!['PAID', 'PAID_CASH', 'PENDING_REVIEW'].includes(booking.paymentStatus) && (
                            <div className="admin-cash-entry">
                              <label htmlFor={`cash-${booking.id}`}>Cash received</label>
                              <input id={`cash-${booking.id}`} type="number" min={booking.paidAmount > 0 ? '0.01' : booking.depositRequired} max={booking.estimatedTotal - booking.paidAmount} step="0.01" value={cashAmounts[booking.id] ?? ''} onChange={(event) => setCashAmounts((current) => ({ ...current, [booking.id]: event.target.value }))} placeholder="Amount" />
                              <button className="action-confirm" type="button" onClick={() => recordCash(booking)}>Record cash</button>
                            </div>
                          )}
                          {booking.status === 'CONFIRMED' && (
                            <button className="ops-reschedule-button" type="button" onClick={() => { setOpsNotice(''); setRescheduleTarget(booking) }}><CalendarClock size={14} /> Reschedule</button>
                          )}
                          {!['PAID', 'PAID_CASH'].includes(booking.paymentStatus) && <button className="action-decline" type="button" onClick={() => cancelBooking(booking)}><X size={14} /> Cancel</button>}
                        </>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          </>)}
          <footer className="admin-footer"><span>Tampisawan admin workspace · booking records</span><a href="/">Back to customer website <ArrowUpRight size={13} /></a></footer>
        </div>
      </main>
      {showBlockDates && token && (
        <BlockDatesModal token={token} onClose={() => setShowBlockDates(false)} onChanged={() => void refreshBookings()} />
      )}
      {rescheduleTarget && token && (
        <RescheduleModal
          booking={rescheduleTarget}
          token={token}
          onClose={() => setRescheduleTarget(null)}
          onDone={(message) => {
            setRescheduleTarget(null)
            setOpsNotice(message)
            void Promise.all([refreshBookings(), loadUsers()])
          }}
        />
      )}
      {showWalkIn && (
        <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowWalkIn(false) }}>
          <section className="admin-walkin-modal" role="dialog" aria-modal="true" aria-labelledby="walkin-title">
            <button type="button" className="admin-modal-close" aria-label="Close walk-in form" onClick={() => setShowWalkIn(false)}><X size={18} /></button>
            <span className="admin-eyebrow"><Wallet size={14} /> TIER 2 · NO RESERVATION</span>
            <h2 id="walkin-title">New Walk-In Cash Booking</h2>
            <p>Record a same-day guest after checking live availability. This creates a confirmed booking with no online gateway fee.</p>
            <form onSubmit={submitWalkIn}>
              <label htmlFor="walkin-guest-name">Guest full name</label>
              <input id="walkin-guest-name" value={walkInName} onChange={(event) => setWalkInName(event.target.value)} maxLength={120} required />
              <label htmlFor="walkin-guest-email">Guest email (optional)</label>
              <input id="walkin-guest-email" type="email" value={walkInEmail} onChange={(event) => setWalkInEmail(event.target.value)} maxLength={254} />
              <fieldset className="admin-walkin-stays">
                <legend>Accommodations · select one or more</legend>
                {walkInPricedStays.map((accommodation) => {
                  const checked = walkInAccommodationIds.includes(accommodation.id)
                  return (
                    <label key={accommodation.id} className={checked ? 'is-checked' : ''}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={checked && walkInAccommodationIds.length === 1}
                        onChange={() => toggleWalkInAccommodation(accommodation.id)}
                      />
                      <span>{accommodation.name}<em>Up to {accommodation.capacity} pax</em></span>
                      <small>{formatPeso(accommodation.baseRate)}</small>
                    </label>
                  )
                })}
              </fieldset>
              <label htmlFor="walkin-tour">Tour package</label>
              <select id="walkin-tour" value={walkInTourType} onChange={(event) => setWalkInTourType(event.target.value as Booking['tourType'])}>
                <option value="OVERNIGHT">Overnight · 22 hours</option>
                <option value="DAY_TOUR">Day Tour</option>
                <option value="NIGHT_TOUR">Night Tour</option>
              </select>
              <div className="admin-walkin-date-row">
                <span><label htmlFor="walkin-checkin">Check-in · today</label><input id="walkin-checkin" type="date" value={walkInCheckIn} min={todayInManila()} max={todayInManila()} onChange={(event) => setWalkInCheckIn(event.target.value)} required /></span>
                <span><label htmlFor="walkin-checkout">Check-out</label><input id="walkin-checkout" type="date" value={walkInCheckOut} min={nextDate(walkInCheckIn)} onChange={(event) => setWalkInCheckOut(event.target.value)} required /></span>
              </div>
              <div className="admin-walkin-guests">
                {([
                  ['adults', 'Adults'],
                  ['seniorsPwd', 'Senior / PWD'],
                  ['children', 'Children'],
                ] as const).map(([field, label]) => (
                  <span key={field}>
                    <label htmlFor={`walkin-${field}`}>{label}</label>
                    <input id={`walkin-${field}`} type="number" min={field === 'adults' ? 1 : 0} max={100} value={walkInGuests[field]} onChange={(event) => setWalkInGuests((current) => ({ ...current, [field]: Number(event.target.value) }))} required />
                  </span>
                ))}
              </div>
              {(() => {
                const max = walkInGuestLimit
                const count = walkInGuests.adults + walkInGuests.seniorsPwd + walkInGuests.children
                return (
                  <p className={count > max ? 'admin-walkin-pax is-over' : 'admin-walkin-pax'} role={count > max ? 'alert' : undefined}>
                    {`${count} guests · room for ${walkInRoomPax}${count > walkInRoomPax ? ' (extra guests pay entrance)' : ''}`}{count > max ? ` · one booking can have up to ${max} guests` : ''}
                  </p>
                )
              })()}
              <div className="admin-walkin-total">
                <span>Base Resort Rate (net to resort)<b>{formatPeso(walkInTotal)}</b></span>
                <span>Gateway / API Fee<b>{formatPeso(0)}</b></span>
                <strong>Cash due and recorded<b>{formatPeso(walkInTotal)}</b></strong>
              </div>
              {walkInError && <p className="admin-error" role="alert">{walkInError}</p>}
              <button type="submit" className="walkin-submit-button" disabled={walkInSubmitting || walkInGuests.adults + walkInGuests.seniorsPwd + walkInGuests.children > walkInGuestLimit}>
                {walkInSubmitting ? 'Saving walk-in…' : 'Confirm Cash Received & Log Booking'} <Plus size={15} />
              </button>
            </form>
          </section>
        </div>
      )}
      {receiptBooking && <BookingReceiptModal booking={receiptBooking} onClose={() => setReceiptBooking(null)} />}
    </div>
  )
}

export default AdminPage
