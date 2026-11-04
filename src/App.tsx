import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Compass,
  House,
  LogOut,
  Leaf,
  MapPin,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  TentTree,
  Users,
  Waves,
  X,
} from 'lucide-react'
import { accommodations } from './data/accommodations'
import {
  type Booking,
  type PaymentMethod,
  type TourType,
  displayCheckoutDate,
  tourDetails,
} from './data/bookings'
import {
  createBookingRequest,
  fetchCustomerBookings,
  submitPaymentProof as sendPaymentProof,
} from './api/bookings'
import { calculateBookingTotal, formatPeso } from './utils/pricing'
import AdminPage from './AdminPage'
import AuthPage from './AuthPage'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/useAuth'
import ProtectedRoute from './ProtectedRoute'
import './App.css'

type GuestType = 'adults' | 'seniorsPwd' | 'children'

const guestLabels: Record<GuestType, { title: string; detail: string }> = {
  adults: { title: 'Adults', detail: '11 years and above' },
  seniorsPwd: { title: 'Senior / PWD', detail: 'Entrance rate depends on tour type' },
  children: { title: 'Children', detail: '10 years old and below' },
}

const amenityGroups = [
  ['Free Wi-Fi', 'Billiards', 'Basketball half court', 'Badminton', 'Videoke'],
  ['Bonfire pit', 'Big screen projector', 'Sari-sari store', 'Camping tent', 'Dart game'],
]

const tomorrow = () => {
  const date = new Date()
  date.setDate(date.getDate() + 1)
  return date.toLocaleDateString('en-CA')
}

const addDays = (date: string, days: number) => {
  if (!date) return ''
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day + days))
  return next.toISOString().slice(0, 10)
}

const daysBetween = (startDate: string, endDate: string) => {
  if (!startDate || !endDate) return 1
  const [startYear, startMonth, startDay] = startDate.split('-').map(Number)
  const [endYear, endMonth, endDay] = endDate.split('-').map(Number)
  const start = Date.UTC(startYear, startMonth - 1, startDay)
  const end = Date.UTC(endYear, endMonth - 1, endDay)
  return Math.max(1, Math.round((end - start) / 86_400_000))
}

function balanceDueAt(checkOutDate: string, tourType: TourType) {
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

function paymentInstructions(method: PaymentMethod) {
  return method === 'GCASH'
    ? 'Send your payment to GCash: 09778510927.'
    : 'Contact the resort for payment instructions for this method.'
}

function CustomerPage() {
  const { user, token, logout } = useAuth()
  const [selectedId, setSelectedId] = useState(accommodations[0].id)
  const [tourType, setTourType] = useState<TourType>('OVERNIGHT')
  const [checkInDate, setCheckInDate] = useState(tomorrow)
  const [checkOutDate, setCheckOutDate] = useState(() => addDays(tomorrow(), 1))
  const [guests, setGuests] = useState({ adults: 2, seniorsPwd: 0, children: 0 })
  const [showReview, setShowReview] = useState(false)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [storageError, setStorageError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [bookingReference, setBookingReference] = useState('')
  const [lookupReference, setLookupReference] = useState('')
  const [lookupBookingId, setLookupBookingId] = useState('')
  const [paymentReference, setPaymentReference] = useState('')
  const [payerAccount, setPayerAccount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('GCASH')
  const [paymentChoice, setPaymentChoice] = useState<'DEPOSIT' | 'FULL'>('DEPOSIT')
  const [paymentAmountInput, setPaymentAmountInput] = useState('')
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null)
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentNotification, setPaymentNotification] = useState<{ message: string; rejected: boolean; bookingId: string } | null>(null)
  const [lookupError, setLookupError] = useState('')
  const previousPaymentStatuses = useRef<Map<string, string> | null>(null)
  const paymentReportFormRef = useRef<HTMLFormElement>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const closeReviewRef = useRef<HTMLButtonElement>(null)

  const selectedStay =
    accommodations.find((stay) => stay.id === selectedId) ?? accommodations[0]
  const stayDays = daysBetween(checkInDate, checkOutDate)
  const totals = useMemo(
    () => calculateBookingTotal(selectedStay, guests, stayDays, tourType),
    [selectedStay, guests, stayDays, tourType],
  )
  const guestCount = guests.adults + guests.seniorsPwd + guests.children

  useEffect(() => {
    if (!user || !token) {
      previousPaymentStatuses.current = null
      return
    }
    const controller = new AbortController()
    const refresh = () => {
      fetchCustomerBookings(token, controller.signal)
        .then((customerBookings) => {
          if (controller.signal.aborted) return
          const currentStatuses = new Map(
            customerBookings.flatMap((booking) => booking.payments.map((payment) => [payment.id, payment.status] as const)),
          )
          if (previousPaymentStatuses.current) {
            const approvedPayment = customerBookings
              .flatMap((booking) => booking.payments.map((payment) => ({ booking, payment })))
              .find(({ payment }) =>
                previousPaymentStatuses.current?.get(payment.id) === 'PENDING_REVIEW' &&
                payment.status === 'RECEIVED',
              )
            if (approvedPayment) {
              setPaymentNotification(
                {
                  message: approvedPayment.booking.status === 'DATE_UNAVAILABLE'
                    ? `Your payment of ${formatPeso(approvedPayment.payment.amount)} was received, but another verified booking secured the dates for ${approvedPayment.booking.accommodationName}. The resort will contact you about the next steps.`
                    : `Payment of ${formatPeso(approvedPayment.payment.amount)} for ${approvedPayment.booking.accommodationName} was approved by the resort.`,
                  rejected: false,
                  bookingId: approvedPayment.booking.id,
                },
              )
            } else {
              const rejectedPayment = customerBookings
                .flatMap((booking) => booking.payments.map((payment) => ({ booking, payment })))
                .find(({ payment }) =>
                  previousPaymentStatuses.current?.get(payment.id) === 'PENDING_REVIEW' &&
                  payment.status === 'NOT_RECEIVED',
                )
              if (rejectedPayment) {
                setPaymentNotification({
                  message: `The resort did not receive your ${formatPeso(rejectedPayment.payment.amount)} payment for ${rejectedPayment.booking.accommodationName}. Please check your transaction and try again.`,
                  rejected: true,
                  bookingId: rejectedPayment.booking.id,
                })
              }
            }
          }
          previousPaymentStatuses.current = currentStatuses
          setBookings(customerBookings)
          setStorageError('')
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) setStorageError(error instanceof Error ? error.message : 'Could not load your inquiries.')
        })
    }
    refresh()
    const interval = window.setInterval(refresh, 15000)
    return () => {
      window.clearInterval(interval)
      controller.abort()
    }
  }, [token, user])

  useEffect(() => {
    if (!showReview) return

    const reviewButton = reviewButtonRef.current
    closeReviewRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowReview(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      reviewButton?.focus()
    }
  }, [showReview])

  const changeGuestCount = (type: GuestType, delta: number) => {
    setGuests((current) => ({
      ...current,
      [type]: Math.max(0, current[type] + delta),
    }))
  }

  const chooseStay = (stayId: string) => {
    setSelectedId(stayId)
    document.getElementById('booking')?.scrollIntoView({ behavior: 'smooth' })
  }

  const formattedDate = (date: string) => {
    if (!date) return 'Choose a date'
    return new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const submitInquiry = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      setStorageError('Choose a check-out date after check-in.')
      return
    }
    if (!user) {
      setStorageError('Sign in before sending an inquiry.')
      return
    }

    if (!token) {
      setStorageError('Your sign-in session expired. Please sign in again.')
      return
    }
    if (!paymentProofFile) {
      setStorageError('Choose a screenshot of your downpayment or full payment before sending the inquiry.')
      return
    }

    const booking: Omit<Booking, 'id' | 'createdAt' | 'status' | 'paymentStatus' | 'paymentAmount' | 'paidAmount' | 'payments' | 'paymentMethod' | 'paymentReference' | 'proofFileName' | 'hasPaymentProof'> = {
      customerName: user.name,
      customerContact: user.email,
      accommodationId: selectedStay.id,
      accommodationName: selectedStay.name,
      tourType,
      checkInDate,
      checkOutDate,
      guests: { ...guests },
      guestCount,
      estimatedTotal: totals.grandTotal,
      depositRequired: totals.depositRequired,
    }

    setPaymentSubmitting(true)
    try {
      const reference = await createBookingRequest(token, booking, {
        amount: paymentChoice === 'FULL' ? totals.grandTotal : totals.depositRequired,
        method: paymentMethod,
        reference: paymentReference.trim(),
        payerAccount: payerAccount.trim(),
        proof: paymentProofFile,
      })
      setBookingReference(reference)
      setBookings(await fetchCustomerBookings(token))
      setStorageError('')
      setPaymentProofFile(null)
      setPaymentReference('')
      setPayerAccount('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not send your inquiry.')
    } finally {
      setPaymentSubmitting(false)
    }
  }

  const findInquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = bookings.find(
      (booking) =>
        booking.id.toLowerCase() === lookupReference.trim().toLowerCase() &&
        booking.customerContact.toLowerCase() === user?.email.toLowerCase() &&
        booking.customerContact.toLowerCase() === user?.email.toLowerCase(),
    )
    setLookupError(found ? '' : 'We couldn’t find an inquiry with that reference and contact.')
    setLookupBookingId(found?.id ?? '')
    setPaymentReference('')
    setPayerAccount('')
    setPaymentChoice('DEPOSIT')
    setPaymentAmountInput(found && found.paidAmount > 0
      ? (found.estimatedTotal - found.paidAmount).toFixed(2)
      : '')
    setPaymentProofFile(null)
  }

  const selectCustomerBooking = (booking: Booking) => {
    setLookupReference(booking.id)
    setLookupBookingId(booking.id)
    setLookupError('')
    setPaymentReference('')
    setPayerAccount('')
    setPaymentChoice('DEPOSIT')
    setPaymentAmountInput(booking.paidAmount > 0
      ? (booking.estimatedTotal - booking.paidAmount).toFixed(2)
      : '')
    setPaymentProofFile(null)
  }

  const retryPayment = (booking: Booking) => {
    selectCustomerBooking(booking)
    window.setTimeout(() => {
      paymentReportFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      paymentReportFormRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(
        'input:not([type="file"]), select',
      )?.focus({ preventScroll: true })
    }, 0)
  }

  const reportPayment = async (event: FormEvent<HTMLFormElement>, booking: Booking) => {
    event.preventDefault()
    const reference = paymentReference.trim()
    const account = payerAccount.trim()
    if (!paymentProofFile || !token) {
      setLookupError('Choose a screenshot of your payment before submitting.')
      return
    }
    if (!reference || !account) {
      setLookupError('Enter the transaction reference and the name and number of the account you paid from.')
      return
    }
    const paymentAmount = booking.paidAmount > 0
      ? Number(paymentAmountInput)
      : paymentChoice === 'FULL' ? booking.estimatedTotal : booking.depositRequired
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || paymentAmount > booking.estimatedTotal - booking.paidAmount) {
      setLookupError('Enter an amount greater than zero and no more than the remaining balance.')
      return
    }
    setPaymentSubmitting(true)
    try {
      await sendPaymentProof(token, booking.id, {
        paymentMethod,
        paymentReference: reference,
        payerAccount: account,
        paymentAmount,
        proof: paymentProofFile,
      })
      setBookings(await fetchCustomerBookings(token))
      setLookupError('')
      setPaymentReference('')
      setPayerAccount('')
      setPaymentProofFile(null)
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'Could not submit payment proof.')
    } finally {
      setPaymentSubmitting(false)
    }
  }

  const lookupBooking = bookings.find((booking) => booking.id === lookupBookingId)

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#home" aria-label="Tampisawan home">
          <span className="brand-mark"><Waves size={22} strokeWidth={2.2} /></span>
          <span className="brand-copy">
            <strong>TAMPISAWAN</strong>
            <small>927 Abelyn&apos;s Private Pool</small>
          </span>
        </a>
        <nav className="main-nav" aria-label="Main navigation">
          <a href="#stays">Stay & unwind</a>
          <a href="#amenities">Amenities</a>
          <a href="#my-inquiry">My bookings & payments</a>
          <a href="#booking">Plan your visit</a>
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <a className="header-account" href="/login">{user.email}</a>
              <button className="header-signout" type="button" aria-label="Sign out" onClick={() => logout().catch((error: unknown) => setLogoutError(error instanceof Error ? error.message : 'Could not sign out.'))}><LogOut size={15} /></button>
            </>
          ) : <a className="header-account" href="/login">Sign in</a>}
          <a className="header-cta" href="#booking">Book a tour <ArrowUpRight size={16} /></a>
        </div>
        {logoutError && <p className="header-error" role="alert">{logoutError}</p>}
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy">
            <span className="eyebrow"><Sparkles size={14} /> YOUR PRIVATE POOL ESCAPE</span>
            <h1>Slow down.<br />Stay a little <em>longer.</em></h1>
            <p>
              Make room for day tours, night swims, and overnight stays at
              Tampisawan.
            </p>
            <div className="hero-actions">
              <a className="button button-light" href="#stays">
                Explore accommodations <ArrowDown size={16} />
              </a>
              <span className="hero-hours"><Clock3 size={16} /> Day tours, night tours, and overnight stays</span>
            </div>
            <div className="hero-trust">
              <span><Check size={15} /> Private pool</span>
              <span><Check size={15} /> Spaces for every group</span>
              <span><Check size={15} /> Easy rate preview</span>
            </div>
          </div>
          <div className="hero-art" aria-label="Illustration of a private pool retreat" role="img">
            <div className="art-sun" />
            <div className="art-hill art-hill-back" />
            <div className="art-hill art-hill-front" />
            <div className="art-palm palm-one"><i /><i /><i /><i /><b /></div>
            <div className="art-palm palm-two"><i /><i /><i /><i /><b /></div>
            <div className="art-pool"><span /></div>
            <div className="art-caption"><MapPin size={15} /> A little place to feel away</div>
          </div>
          <div className="hero-scroll"><span /> SCROLL TO EXPLORE</div>
        </section>

        <section className="intro-strip" aria-label="Stay details">
          <div><span className="strip-icon"><Clock3 size={19} /></span><span><b>Flexible tour times</b><small>Day, night, or overnight</small></span></div>
          <div><span className="strip-icon"><Users size={19} /></span><span><b>Up to 20 guests</b><small>Room and event space capacities</small></span></div>
          <div><span className="strip-icon"><Waves size={19} /></span><span><b>Poolside moments</b><small>Bring your favorite people</small></span></div>
          <a href="#rates">See all rates <ArrowRight size={16} /></a>
        </section>

        <section className="stays-section section-wrap" id="stays">
          <div className="section-heading">
            <div>
              <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> FIND YOUR SPACE</span>
              <h2>Make yourself <em>at home.</em></h2>
              <p>Pick the place that fits your people. Every stay is yours to make special.</p>
            </div>
            <a className="text-link" href="#rates">View rate details <ArrowUpRight size={16} /></a>
          </div>
          <div className="stay-grid">
            {accommodations.map((stay, index) => {
              const isSelected = selectedId === stay.id
              return (
                <article className={`stay-card ${isSelected ? 'is-selected' : ''}`} key={stay.id}>
                  <div className={`stay-art stay-art-${index + 1}`}>
                    <span className="stay-art-icon">
                      {index === 3 || index === 7 ? <TentTree size={29} /> : index === 2 || index === 5 ? <Compass size={29} /> : <House size={29} />}
                    </span>
                    <span className="stay-capacity"><Users size={14} /> Up to {stay.capacity}</span>
                    {stay.entranceFeeForAll && <span className="fee-pill">Entrance fee applies</span>}
                  </div>
                  <div className="stay-card-body">
                    <div className="stay-title-row">
                      <div>
                        <h3>{stay.name}</h3>
                        <span className="stay-subtitle">{stay.category}</span>
                      </div>
                      <div className="stay-price"><strong>{formatPeso(stay.baseRate)}</strong><small>per day / session</small></div>
                    </div>
                    <ul className="feature-list">
                      {stay.features.slice(0, 3).map((feature) => <li key={feature}><Check size={13} /> {feature}</li>)}
                    </ul>
                    <button className={`select-stay ${isSelected ? 'selected' : ''}`} type="button" onClick={() => chooseStay(stay.id)}>
                      {isSelected ? <><Check size={15} /> Selected</> : <>Choose this stay <ArrowRight size={15} /></>}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="booking-section" id="booking">
          <div className="booking-inner section-wrap">
            <div className="booking-intro">
              <span className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> YOUR STAY, YOUR WAY</span>
              <h2>Plan your<br /><em>poolside escape.</em></h2>
              <p>Choose a tour type, accommodation, dates, and guests. Accommodation and applicable excess-guest entrance fees are charged for each booked day.</p>
              <div className="booking-note"><ShieldCheck size={18} /><span><b>Just a preview for now</b><small>Availability and final pricing are confirmed by the resort.</small></span></div>
            </div>

            <div className="booking-card">
              <div className="booking-card-head">
                <div><span className="form-step">01</span><div><h3>Your booking details</h3><p>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</p></div></div>
                <span className="booking-tag"><Leaf size={13} /> TAMPISAWAN</span>
              </div>
              <div className="form-field">
                <label htmlFor="tour-type">Tour type</label>
                <select id="tour-type" value={tourType} onChange={(event) => setTourType(event.target.value as TourType)}>
                  <option value="OVERNIGHT">Overnight · 2:00 PM–12:00 NN</option>
                  <option value="DAY_TOUR">Day Tour · 7:00 AM–5:00 PM</option>
                  <option value="NIGHT_TOUR">Night Tour · 7:00 PM–6:00 AM</option>
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="accommodation">Accommodation</label>
                <select id="accommodation" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  {accommodations.map((stay) => <option value={stay.id} key={stay.id}>{stay.name} · {formatPeso(stay.baseRate)} / day</option>)}
                </select>
                <small className="field-hint">Capacity: up to {selectedStay.capacity} guests</small>
              </div>
              <div className="date-fields">
                <div className="form-field">
                  <label htmlFor="check-in">Check-in</label>
                  <input id="check-in" type="date" min={tomorrow()} value={checkInDate} onChange={(event) => {
                    const nextCheckIn = event.target.value
                    setCheckInDate(nextCheckIn)
                    if (checkOutDate <= nextCheckIn) setCheckOutDate(addDays(nextCheckIn, 1))
                  }} />
                  <small className="field-hint">{tourDetails[tourType].checkIn} · {formattedDate(checkInDate)}</small>
                </div>
                <div className="date-arrow"><ArrowRight size={16} /></div>
                <div className="form-field">
                  <label htmlFor="check-out">{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'}</label>
                  <input
                    id="check-out"
                    type="date"
                    min={tourType === 'DAY_TOUR' ? checkInDate : addDays(checkInDate, 1)}
                    value={tourType === 'DAY_TOUR' ? displayCheckoutDate(checkOutDate, tourType) : checkOutDate}
                    onChange={(event) => setCheckOutDate(tourType === 'DAY_TOUR' ? addDays(event.target.value, 1) : event.target.value)}
                  />
                  <small className="field-hint">{tourDetails[tourType].checkOut} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</small>
                </div>
              </div>
              <div className="form-field guest-field">
                <div className="guest-heading"><label>Guests</label><span>{guestCount} {guestCount === 1 ? 'guest' : 'guests'}</span></div>
                <div className="guest-list">
                  {(Object.keys(guestLabels) as GuestType[]).map((type) => (
                    <div className="guest-row" key={type}>
                      <span><b>{guestLabels[type].title}</b><small>{guestLabels[type].detail}</small></span>
                      <div className="guest-stepper">
                        <button type="button" aria-label={`Remove one ${guestLabels[type].title.toLowerCase()}`} disabled={guests[type] === 0 || (type === 'adults' && guests.adults === 1)} onClick={() => changeGuestCount(type, -1)}><Minus size={14} /></button>
                        <strong>{guests[type]}</strong>
                        <button type="button" aria-label={`Add one ${guestLabels[type].title.toLowerCase()}`} onClick={() => changeGuestCount(type, 1)}><Plus size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="estimate-box">
                <div className="estimate-heading"><span><Sparkles size={15} /> YOUR ESTIMATED TOTAL</span><small>PHP</small></div>
                <div className="estimate-line"><span>{selectedStay.name} · {stayDays} {stayDays === 1 ? 'day' : 'days'} × {formatPeso(totals.dailyBaseRate)}</span><b>{formatPeso(totals.baseRate)}</b></div>
                <div className="estimate-line"><span>{tourDetails[tourType].label} entrance fee · {totals.chargeableGuests} {selectedStay.entranceFeeForAll ? 'guest' : 'excess guest'}{totals.chargeableGuests === 1 ? '' : 's'} × {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formatPeso(totals.entranceFees)}</b></div>
                <div className="estimate-divider" />
                <div className="estimate-total"><span>Estimated total</span><b>{formatPeso(totals.grandTotal)}</b></div>
                <div className="deposit-row"><span>50% deposit estimate</span><b>{formatPeso(totals.depositRequired)}</b></div>
                <p className="estimate-disclaimer">
                  {selectedStay.entranceFeeForAll
                    ? `Entrance fees apply to every guest for each of the ${stayDays} ${stayDays === 1 ? 'day' : 'days'}.`
                    : `Entrance fees apply per day to guests above the ${selectedStay.capacity}-guest capacity.`}
                </p>
              </div>
              <button ref={reviewButtonRef} className="review-button" type="button" onClick={() => { setBookingReference(''); if (!user) { window.location.assign('/login?next=booking'); return }; setShowReview(true) }} disabled={!checkInDate || !checkOutDate || checkOutDate <= checkInDate || guestCount === 0}>
                {user ? 'Review booking details' : 'Sign in to inquire'} <ArrowRight size={17} />
              </button>
              <p className="form-footnote">A downpayment is required before your inquiry can be sent.</p>
            </div>
          </div>
        </section>

        <section className="customer-followup section-wrap" id="my-inquiry">
          <div className="customer-followup-copy">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> CUSTOMER INQUIRY</span>
            <h2>Already sent an<br /><em>inquiry?</em></h2>
            <p>Check whether the resort has verified your payment. If you paid a downpayment, submit the remaining balance before checkout.</p>
            <div className="followup-note"><ShieldCheck size={17} /> Inquiries and payment reports are saved to the resort database.</div>
          </div>
          <div className="followup-card">
            {paymentNotification && (
              <div className={`payment-notification ${paymentNotification.rejected ? 'is-rejected' : ''}`} role={paymentNotification.rejected ? 'alert' : 'status'}>
                {paymentNotification.rejected ? <AlertTriangle size={16} /> : <Check size={16} />}
                <span>{paymentNotification.message}</span>
                {paymentNotification.rejected && (() => {
                  const booking = bookings.find((item) => item.id === paymentNotification.bookingId)
                  return booking && !['CANCELLED', 'DATE_UNAVAILABLE'].includes(booking.status) && booking.paymentStatus !== 'PAID' && booking.paymentStatus !== 'PENDING_REVIEW'
                    ? <button className="payment-retry-button" type="button" onClick={() => retryPayment(booking)}>Try payment again</button>
                    : null
                })()}
                <button type="button" aria-label="Dismiss notification" onClick={() => setPaymentNotification(null)}><X size={14} /></button>
              </div>
            )}
            {storageError && <p className="customer-error" role="alert">{storageError}</p>}
            {bookingReference && <div className="inquiry-success"><Check size={17} /><span><b>Inquiry sent</b><small>Save this reference to check your request: <strong>{bookingReference}</strong></small></span></div>}
            {user && (
              <div className="customer-bookings">
                <div className="customer-bookings-heading">
                  <h3>Your bookings</h3>
                  <p>Select a booking to view its payment history or pay early.</p>
                </div>
                {bookings.length === 0 ? (
                  <p className="customer-bookings-empty">Your bookings and payment options will appear here after you send an inquiry.</p>
                ) : bookings.map((booking) => {
                  const canPay = !['CANCELLED', 'DATE_UNAVAILABLE'].includes(booking.status) &&
                    ['UNPAID', 'NOT_PAID', 'PARTIALLY_PAID'].includes(booking.paymentStatus)
                  const balance = Math.max(0, booking.estimatedTotal - booking.paidAmount)
                  const lastRejectedPayment = [...booking.payments].reverse().find((payment) => payment.status === 'NOT_RECEIVED')
                  return (
                    <article className="customer-booking-option" key={booking.id}>
                      <div>
                        <b>{booking.accommodationName}</b>
                        <small>{tourDetails[booking.tourType].label} · {formattedDate(booking.checkInDate)} – {formattedDate(displayCheckoutDate(booking.checkOutDate, booking.tourType))}</small>
                        {lastRejectedPayment && booking.paymentStatus !== 'PENDING_REVIEW' && (
                          <span className="customer-booking-warning" role="alert">
                            The admin did not receive your {formatPeso(lastRejectedPayment.amount)} payment. Please try again.
                          </span>
                        )}
                        <span className={booking.status === 'DATE_UNAVAILABLE' ? 'customer-date-unavailable' : ''}>
                          {booking.status === 'DATE_UNAVAILABLE'
                            ? 'Payment received, but dates were secured by an earlier-verified booking. The resort will contact you about next steps.'
                            : booking.paymentStatus === 'PENDING_REVIEW'
                            ? 'Payment awaiting admin review'
                            : booking.paymentStatus === 'PAID'
                              ? 'Fully paid'
                              : booking.status === 'CANCELLED'
                                ? 'Booking cancelled'
                                : booking.paidAmount > 0
                                  ? `Remaining balance: ${formatPeso(balance)}`
                                  : `Payment required: at least ${formatPeso(booking.depositRequired)}`}
                        </span>
                        {booking.status === 'DATE_UNAVAILABLE' && (
                          <small className="customer-date-unavailable">
                            For refund follow-up or alternatives, message the resort on{' '}
                            <a href="https://www.facebook.com/profile.php?id=61553358111597" target="_blank" rel="noreferrer">Facebook</a>.
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className={booking.paymentStatus === 'PARTIALLY_PAID' && canPay ? 'customer-early-pay-button' : 'customer-booking-view-button'}
                        onClick={() => selectCustomerBooking(booking)}
                      >
                        {booking.paymentStatus === 'PARTIALLY_PAID' && canPay
                          ? 'Pay early'
                          : canPay
                            ? 'Make a payment'
                            : 'View payment history'}
                        <ArrowRight size={14} />
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
            {user ? <form className="lookup-form" onSubmit={findInquiry}>
              <h3>Check your inquiry</h3>
              <label htmlFor="lookup-reference">Inquiry reference</label>
              <input id="lookup-reference" value={lookupReference} onChange={(event) => setLookupReference(event.target.value)} placeholder="e.g. TS-ABC123" required />
              <label htmlFor="lookup-contact">Phone or email used on the request</label>
              <input id="lookup-contact" value={user.email || user.username} placeholder="Your account" readOnly required />
              <button className="review-button" type="submit">Find inquiry <ArrowRight size={16} /></button>
              {lookupError && <p className="customer-error" role="alert">{lookupError}</p>}
            </form> : <div className="lookup-signin"><p>Sign in with the account used for your inquiry to check its status or report a payment.</p><a className="review-button" href="/login">Sign in <ArrowRight size={16} /></a></div>}
            {user && lookupBooking && (
              <div className="lookup-result">
                <div className="lookup-result-top">
                  <span><b>{lookupBooking.accommodationName}</b><small>{tourDetails[lookupBooking.tourType].label} · {formattedDate(lookupBooking.checkInDate)} – {formattedDate(displayCheckoutDate(lookupBooking.checkOutDate, lookupBooking.tourType))} · {lookupBooking.guestCount} guests</small></span>
                  <span className={`status-badge status-${lookupBooking.status.toLowerCase()}`}>{lookupBooking.status === 'PENDING' ? 'Under review' : lookupBooking.status === 'CONFIRMED' ? 'Confirmed' : lookupBooking.status === 'DATE_UNAVAILABLE' ? 'Dates unavailable' : 'Declined'}</span>
                </div>
                <p className="lookup-payment-state"><CircleDollarSign size={15} /> {lookupBooking.status === 'DATE_UNAVAILABLE' ? `Your payment of ${formatPeso(lookupBooking.paidAmount)} was received, but another verified booking secured these dates first. The resort will contact you to arrange a refund or discuss alternatives.` : lookupBooking.status === 'CANCELLED' ? 'This booking was cancelled by the resort.' : lookupBooking.paymentStatus === 'PAID' ? 'Full payment verified. Your booking is successful.' : lookupBooking.paymentStatus === 'PARTIALLY_PAID' ? `Payment received. Remaining balance: ${formatPeso(lookupBooking.estimatedTotal - lookupBooking.paidAmount)}. You can pay early; it must be received by ${formatPhilippineDateTime(balanceDueAt(lookupBooking.checkOutDate, lookupBooking.tourType))}, at least one hour before checkout.` : lookupBooking.paymentStatus === 'PENDING_REVIEW' ? `${lookupBooking.paidAmount > 0 ? `Your previous payment of ${formatPeso(lookupBooking.paidAmount)} was received. ` : ''}Payment proof for ${formatPeso(lookupBooking.paymentAmount ?? 0)} submitted${lookupBooking.paymentMethod ? ` via ${lookupBooking.paymentMethod.replace('_', ' ')}` : ''}; waiting for admin verification.` : lookupBooking.paymentStatus === 'NOT_PAID' ? 'The admin could not verify this payment. Submit a new screenshot to try again.' : 'Your inquiry and payment proof are waiting for admin verification.'}</p>
                {lookupBooking.status === 'DATE_UNAVAILABLE' && (
                  <p className="customer-date-unavailable">
                    To arrange a refund or discuss alternatives, message the resort on{' '}
                    <a href="https://www.facebook.com/profile.php?id=61553358111597" target="_blank" rel="noreferrer">Facebook</a>.
                  </p>
                )}
                {(() => {
                  const rejectedPayment = [...lookupBooking.payments].reverse().find((payment) => payment.status === 'NOT_RECEIVED')
                  return rejectedPayment && lookupBooking.paymentStatus !== 'PENDING_REVIEW'
                    ? <div className="payment-rejected-warning" role="alert"><AlertTriangle size={17} /><span><b>Payment not received</b><small>The admin did not receive your {formatPeso(rejectedPayment.amount)} payment. Please check your transaction details and submit the payment again.</small></span></div>
                    : null
                })()}
                <div className="customer-payment-history">
                  <b>Payment history</b>
                  {lookupBooking.payments.map((payment) => (
                    <div className="customer-payment-entry" key={payment.id}>
                      <span>
                        <strong>{formatPeso(payment.amount)} · {payment.method === 'CASH' ? 'Cash' : payment.method.replace('_', ' ')}</strong>
                        <small>{new Date(payment.submittedAt).toLocaleString('en-PH')}{payment.verifiedAt ? ` · ${new Date(payment.verifiedAt).toLocaleString('en-PH')}` : ''}</small>
                      </span>
                      <b className={`payment-history-status history-${payment.status.toLowerCase()}`}>{payment.status === 'PENDING_REVIEW' ? 'Awaiting review' : payment.status === 'RECEIVED' ? 'Approved' : 'Not received'}</b>
                    </div>
                  ))}
                </div>
                {(['UNPAID', 'NOT_PAID', 'PARTIALLY_PAID'].includes(lookupBooking.paymentStatus)) && !['CANCELLED', 'DATE_UNAVAILABLE'].includes(lookupBooking.status) && (
                  <form ref={paymentReportFormRef} className="payment-report-form" onSubmit={(event) => reportPayment(event, lookupBooking)}>
                    <b>{lookupBooking.paidAmount > 0 ? `Pay any amount toward the remaining ${formatPeso(lookupBooking.estimatedTotal - lookupBooking.paidAmount)} balance` : `Payment required: at least ${formatPeso(lookupBooking.depositRequired)}`}</b>
                    {lookupBooking.paidAmount === 0 && (
                      <>
                        <label htmlFor="payment-amount">Choose payment amount</label>
                        <select id="payment-amount" value={paymentChoice} onChange={(event) => setPaymentChoice(event.target.value as 'DEPOSIT' | 'FULL')} required>
                          <option value="DEPOSIT">Downpayment · {formatPeso(lookupBooking.depositRequired)}</option>
                          <option value="FULL">Full payment · {formatPeso(lookupBooking.estimatedTotal)}</option>
                        </select>
                      </>
                    )}
                    {lookupBooking.paidAmount > 0 && (
                      <>
                        <label htmlFor="early-payment-amount">Payment amount (you may pay early)</label>
                        <input id="early-payment-amount" type="number" min="0.01" max={lookupBooking.estimatedTotal - lookupBooking.paidAmount} step="0.01" value={paymentAmountInput} onChange={(event) => setPaymentAmountInput(event.target.value)} required />
                      </>
                    )}
                    <label htmlFor="payment-method">Payment method</label>
                    <select id="payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} required>
                      <option value="GCASH">GCash</option>
                      <option value="MAYA">Maya</option>
                      <option value="BANK_TRANSFER">Bank transfer</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <p className="payment-instructions">{paymentInstructions(paymentMethod)}</p>
                    <label htmlFor="payment-reference">Payment reference number</label>
                    <input id="payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Transaction/reference number" maxLength={120} required />
                    <label htmlFor="payment-payer-account">Account name and number used to pay</label>
                    <input id="payment-payer-account" value={payerAccount} onChange={(event) => setPayerAccount(event.target.value)} placeholder="GCash/Maya number or bank account" maxLength={200} required />
                    <small>Only share the account name and number used for this transfer. Never share your PIN, password, or OTP.</small>
                    <label htmlFor="payment-proof">Payment screenshot (PNG, JPEG, or WebP; max 5 MB)</label>
                    <input id="payment-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)} required />
                    {paymentProofFile && <small>Selected: {paymentProofFile.name}</small>}
                    <button className="select-stay selected" type="submit" disabled={paymentSubmitting}>{paymentSubmitting ? 'Submitting…' : 'Send payment for verification'} <ArrowRight size={14} /></button>
                    <small>The admin must verify the payment before it is counted as received. Balance is due at least one hour before checkout.</small>
                  </form>
                )}
              </div>
            )}
          </div>
        </section>

        <section className="amenities-section section-wrap" id="amenities">
          <div className="amenities-copy">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> LITTLE EXTRAS, BIG MEMORIES</span>
            <h2>More time for<br /><em>the good stuff.</em></h2>
            <p>Take a dip, start a friendly match, or make an evening of it. Enjoy these shared amenities during your stay.</p>
            <a className="text-link" href="#booking">Start planning <ArrowUpRight size={16} /></a>
          </div>
          <div className="amenity-panel">
            <div className="amenity-panel-top"><span className="amenity-symbol"><Sparkles size={19} /></span><span><b>Included amenities</b><small>Make the most of your time together</small></span></div>
            {amenityGroups.map((group, index) => (
              <ul className="amenity-list" key={index}>
                {group.map((amenity) => <li key={amenity}><span><Check size={14} /></span>{amenity}</li>)}
              </ul>
            ))}
            <div className="amenity-bottom"><span>Slow mornings. Long afternoons. Your kind of day.</span><Waves size={19} /></div>
          </div>
        </section>

        <section className="rates-section" id="rates">
          <div className="section-wrap rates-inner">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> GOOD TO KNOW</span>
            <div className="rates-heading">
              <h2>Simple rates.<br /><em>More good times.</em></h2>
              <p>Choose an Overnight stay (2:00 PM–12:00 NN), Day Tour (7:00 AM–5:00 PM), or Night Tour (7:00 PM–6:00 AM). The listed accommodation rate and applicable entrance fees are charged for each booked day.</p>
            </div>
            <div className="rate-details">
              <div className="rate-detail-card"><span className="rate-detail-icon"><Users size={19} /></span><div><b>Day Tour entrance · 7:00 AM–5:00 PM</b><p>Adult ₱150 · Senior / PWD ₱120 · Child (10 years old and below) ₱120</p></div></div>
              <div className="rate-detail-card"><span className="rate-detail-icon"><Users size={19} /></span><div><b>Night Tour entrance · 7:00 PM–6:00 AM</b><p>Adult ₱250 · Senior / PWD ₱150 · Child (10 years old and below) ₱150</p></div></div>
              <div className="rate-detail-card"><span className="rate-detail-icon"><ShieldCheck size={19} /></span><div><b>Room capacity</b><p>For most stays, entrance fees are charged for guests above the listed capacity. Gazebo, Calesa Tables, and Kubo ni Gerrant have entrance fees for all guests.</p></div></div>
            </div>
            <p className="rates-caveat">Multi-day bookings multiply the accommodation rate and applicable entrance fees by each booked day. Capacity is included before entrance fees apply, counting adults first, then seniors/PWD, then children; Gazebo, Calesa Tables, and Kubo ni Gerrant charge entrance fees for all guests. The existing overnight option uses the Night Tour entrance-fee rates. Please confirm availability and final charges with Tampisawan before payment.</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#home">
          <span className="brand-mark"><Waves size={20} /></span>
          <span className="brand-copy"><strong>TAMPISAWAN</strong><small>927 Abelyn&apos;s Private Pool</small></span>
        </a>
        <span className="footer-note">Make space for a little getaway.</span>
        <a className="footer-top" href="#home">Back to top <ArrowUpRight size={15} /></a>
      </footer>

      {showReview && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowReview(false) }}>
          <section className="review-modal inquiry-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <button ref={closeReviewRef} className="modal-close" type="button" aria-label="Close preview" onClick={() => setShowReview(false)}><X size={19} /></button>
            <span className="modal-icon"><ClipboardList size={22} /></span>
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> {bookingReference ? 'INQUIRY SENT' : 'SEND AN INQUIRY'}</span>
            <h2 id="review-title">{bookingReference ? <>Your request is<br /><em>on its way.</em></> : <>One step closer<br /><em>to your getaway.</em></>}</h2>
            <p className="modal-copy">{bookingReference ? <>Payment proof is attached to inquiry <strong>{bookingReference}</strong>. The resort will verify the payment before confirming your booking.</> : 'Choose a downpayment or full payment and attach the transaction screenshot. The resort will verify it before confirming your booking.'}</p>
            <div className="review-details">
              <div><span>Accommodation</span><b>{selectedStay.name}</b></div>
              <div><span>Tour type</span><b>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</b></div>
              <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
              <div><span>{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formattedDate(displayCheckoutDate(checkOutDate, tourType))} · {tourDetails[tourType].checkOut}</b></div>
              <div><span>Guests</span><b>{guestCount} total</b></div>
              <div className="review-total"><span>Estimated total</span><b>{formatPeso(totals.grandTotal)}</b></div>
            </div>
            {bookingReference ? (
              <button className="review-button modal-done" type="button" onClick={() => setShowReview(false)}>Done <Check size={16} /></button>
            ) : (
              <form className="inquiry-submit-form" onSubmit={submitInquiry}>
                <div className="signed-in-identity"><ShieldCheck size={17} /><span><b>{user?.name}</b><small>Signed in as {user?.email}</small></span></div>
                <label htmlFor="initial-payment-amount">Payment amount</label>
                <select id="initial-payment-amount" value={paymentChoice} onChange={(event) => setPaymentChoice(event.target.value as 'DEPOSIT' | 'FULL')}>
                  <option value="DEPOSIT">Downpayment (50%) · {formatPeso(totals.depositRequired)}</option>
                  <option value="FULL">Full payment · {formatPeso(totals.grandTotal)}</option>
                </select>
                <label htmlFor="initial-payment-method">Payment method</label>
                <select id="initial-payment-method" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}>
                  <option value="GCASH">GCash</option>
                  <option value="MAYA">Maya</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="OTHER">Other</option>
                </select>
                <p className="payment-instructions">{paymentInstructions(paymentMethod)}</p>
                <label htmlFor="initial-payment-reference">Transaction reference number</label>
                <input id="initial-payment-reference" value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="Transaction/reference number" maxLength={120} required />
                <label htmlFor="initial-payer-account">Account name and number used to pay</label>
                <input id="initial-payer-account" value={payerAccount} onChange={(event) => setPayerAccount(event.target.value)} placeholder="GCash/Maya number or bank account" maxLength={200} required />
                <small>Only share the account name and number used for this transfer. Never share your PIN, password, or OTP.</small>
                <label htmlFor="initial-payment-proof">Payment screenshot (PNG, JPEG, or WebP; max 5 MB)</label>
                <input id="initial-payment-proof" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setPaymentProofFile(event.target.files?.[0] ?? null)} required />
                {paymentProofFile && <small>Selected: {paymentProofFile.name}</small>}
                {storageError && <p className="customer-error" role="alert">{storageError}</p>}
                <button className="review-button modal-done" type="submit" disabled={paymentSubmitting}>{paymentSubmitting ? 'Sending…' : 'Send payment and inquiry'} <ArrowRight size={16} /></button>
                <p className="form-footnote">Your inquiry is sent after payment proof is attached. Admin verification is required.</p>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  )
}

function App() {
  const route = window.location.pathname.replace(/\/+$/, '') || '/'
  const adminRoute = route === '/admin' || route === '/admin/dashboard'
  const customerRoute = route === '/customer/booking'

  return (
    <AuthProvider>
      {route === '/login' ? <AuthPage /> : adminRoute ? (
        <ProtectedRoute role="ADMIN"><AdminRoute /></ProtectedRoute>
      ) : customerRoute ? (
        <ProtectedRoute role="CUSTOMER"><CustomerPage /></ProtectedRoute>
      ) : <CustomerPage />}
    </AuthProvider>
  )
}

function AdminRoute() {
  const { user, token, loading, logout } = useAuth()
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user) {
      window.location.replace('/login')
      return
    }
    if (user.role !== 'ADMIN') {
      window.location.replace('/')
      return
    }

    let active = true
    fetch('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (response.status === 401) {
          await logout()
          window.location.replace('/login')
          return
        }
        if (response.status === 403) {
          window.location.replace('/')
          return
        }
        if (!response.ok) throw new Error(`Could not verify admin access (${response.status}).`)
        if (active) setChecking(false)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'Could not verify admin access.')
          setChecking(false)
        }
      })

    return () => {
      active = false
    }
  }, [loading, user, token, logout])

  if (loading || checking) return <div className="auth-loading">Verifying your admin access…</div>
  if (error) return <div className="auth-failure" role="alert">{error}<p>Start the API server and try again.</p></div>
  if (!user || user.role !== 'ADMIN') return <div className="auth-loading">Redirecting…</div>
  return <AdminPage />
}

export default App
