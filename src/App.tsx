import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Hourglass,
  Compass,
  House,
  Images,
  Info,
  LogOut,
  Leaf,
  Menu,
  Minus,
  Moon,
  Plus,
  ShieldCheck,
  Sparkles,
  Sun,
  TentTree,
  Users,
  Wallet,
  Waves,
  X,
} from 'lucide-react'
import { accommodations } from './data/accommodations'
import {
  type Booking,
  type TourType,
  displayCheckoutDate,
  formatHoldTimeLeft,
  holdMillisecondsLeft,
  isActiveHold,
  tourDetails,
} from './data/bookings'
import {
  createGcashCheckout,
  createPendingHold,
  fetchAvailability,
  fetchCustomerBookings,
} from './api/bookings'
import HoldCountdown from './components/HoldCountdown'
import { BOOKING_MAX_GUESTS, calculateBookingTotal, combineAccommodations, entranceRates, formatPeso, priceAccommodations, usesOvernightRates } from './utils/pricing'
import ResortLogo from './components/ResortLogo'
import CustomerSideNav from './components/CustomerSideNav'
import ProceedBookingBar from './components/ProceedBookingBar'
import { sideNavSections } from './components/sideNavSections'
import AdminPage from './AdminPage'
import AuthPage from './AuthPage'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/useAuth'
import { useTheme } from './theme/ThemeProvider'
import ProtectedRoute from './ProtectedRoute'
import BookingReceiptModal from './BookingReceiptModal'
import BookingSuccessPage from './BookingSuccessPage'
import BookingCancelledPage from './BookingCancelledPage'
import GeraintChatbot from './components/GeraintChatbot'
import StayGallery from './components/StayGallery'
import HeroShowcase from './components/HeroShowcase'
import FallingLeaves from './components/FallingLeaves'
import AmbientAtmosphere from './components/AmbientAtmosphere'
import { useScrollSpy } from './hooks/useScrollSpy'
import { useAnimateOnScroll } from './hooks/useAnimateOnScroll'
import { useGlassSpotlight, useScrollProgress } from './hooks/useLuxuryEffects'
import Tooltip from './components/Tooltip'
import './App.css'
import './theme/brand.css'
import './theme/luxury.css'
import './theme/sunlit.css'
import './theme/polish.css'
import './theme/buttons.css'
import './theme/readable.css'
import './theme/responsive.css'

type GuestType = 'adults' | 'seniorsPwd' | 'children'
type GuestCounts = Record<GuestType, number>
type GuestBookingDraft = {
  selectedIds: string[]
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  /** Main guests, in the room. */
  guests: GuestCounts
  /** Guests added beyond the room's pax (they pay entrance). */
  extraGuests: GuestCounts
  paymentChoice: PaymentChoice
}

/** How the guest wants to pay: a GCash deposit online, or cash at the resort. */
type PaymentChoice = 'ONLINE' | 'WALKIN'

const noGuests: GuestCounts = { adults: 0, seniorsPwd: 0, children: 0 }
const countGuests = (group: GuestCounts) => group.adults + group.seniorsPwd + group.children

/**
 * Keeps the party consistent with the room: main guests fill the pax that include entrance
 * first, and only the rest are extra guests. When the pax shrink (another tour, fewer rooms),
 * overflow moves to the extras; when they grow, extras move into the room. With no pax
 * included (every guest pays entrance), everyone is a main guest.
 */
function rebalanceParty(party: { main: GuestCounts, extra: GuestCounts }, pax: number | null) {
  const main = { ...party.main }
  const extra = { ...party.extra }
  if (pax === null) {
    for (const type of ['adults', 'seniorsPwd', 'children'] as const) { main[type] += extra[type]; extra[type] = 0 }
  } else {
    let over = countGuests(main) - pax
    for (const type of ['adults', 'seniorsPwd', 'children'] as const) {
      // Keep at least one adult in the room.
      const movable = Math.max(0, Math.min(over, main[type] - (type === 'adults' ? 1 : 0)))
      main[type] -= movable; extra[type] += movable; over -= movable
    }
    let free = pax - countGuests(main)
    for (const type of ['children', 'seniorsPwd', 'adults'] as const) {
      const movable = Math.max(0, Math.min(free, extra[type]))
      extra[type] -= movable; main[type] += movable; free -= movable
    }
  }
  const same = (['adults', 'seniorsPwd', 'children'] as const).every((type) => main[type] === party.main[type] && extra[type] === party.extra[type])
  return same ? party : { main, extra }
}

const GUEST_BOOKING_DRAFT_KEY = 'tampisawan_guest_booking_draft'

/** Header links, in the same order as their sections on the page. */
const navSections = [
  { id: 'stays', label: 'Stay & unwind' },
  { id: 'booking', label: 'Plan your visit' },
  { id: 'my-inquiry', label: 'My bookings & payments' },
  { id: 'amenities', label: 'Amenities' },
]
const sideNavSectionIds = sideNavSections.map((section) => section.id)

/** Known accommodation IDs, de-duplicated, in the resort's listing order. */
function orderedAccommodationIds(ids: string[]) {
  return accommodations.filter((stay) => ids.includes(stay.id)).map((stay) => stay.id)
}

function isTourType(value: unknown): value is TourType {
  return value === 'OVERNIGHT' || value === 'DAY_TOUR' || value === 'NIGHT_TOUR'
}

function isDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function isIntegerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= minimum
}

function readGuestBookingDraft(): GuestBookingDraft | null {
  let stored: string | null
  try {
    stored = sessionStorage.getItem(GUEST_BOOKING_DRAFT_KEY)
  } catch (error) {
    console.error('Could not read guest booking details from session storage:', error)
    return null
  }
  if (!stored) return null
  let value: unknown
  try {
    value = JSON.parse(stored)
  } catch (error) {
    console.error('Could not parse guest booking details from session storage:', error)
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const savedIds: unknown = 'selectedIds' in value
    ? value.selectedIds
    : 'selectedId' in value ? [value.selectedId] : null
  const selectedIds = Array.isArray(savedIds)
    ? orderedAccommodationIds(savedIds.filter((id): id is string => typeof id === 'string'))
    : []
  if (
    selectedIds.length === 0 ||
    !('tourType' in value) || !isTourType(value.tourType) ||
    !('checkInDate' in value) || !isDateInput(value.checkInDate) ||
    !('checkOutDate' in value) || !isDateInput(value.checkOutDate) ||
    value.checkOutDate <= value.checkInDate ||
    !('guests' in value) || typeof value.guests !== 'object' || value.guests === null ||
    !('adults' in value.guests) || !isIntegerAtLeast(value.guests.adults, 1) ||
    !('seniorsPwd' in value.guests) || !isIntegerAtLeast(value.guests.seniorsPwd, 0) ||
    !('children' in value.guests) || !isIntegerAtLeast(value.guests.children, 0)
  ) return null
  const storedExtras = 'extraGuests' in value && typeof value.extraGuests === 'object' && value.extraGuests !== null
    ? value.extraGuests as Record<string, unknown>
    : {}
  const extraCount = (key: GuestType) => isIntegerAtLeast(storedExtras[key], 0) ? storedExtras[key] as number : 0
  return {
    selectedIds,
    tourType: value.tourType,
    checkInDate: value.checkInDate,
    checkOutDate: value.checkOutDate,
    guests: {
      adults: value.guests.adults,
      seniorsPwd: value.guests.seniorsPwd,
      children: value.guests.children,
    },
    extraGuests: { adults: extraCount('adults'), seniorsPwd: extraCount('seniorsPwd'), children: extraCount('children') },
    paymentChoice: 'paymentChoice' in value && value.paymentChoice === 'WALKIN' ? 'WALKIN' : 'ONLINE',
  }
}

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

function CustomerPage() {
  const { user, token, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [guestBookingDraft] = useState(readGuestBookingDraft)
  const [selectedIds, setSelectedIds] = useState<string[]>(guestBookingDraft?.selectedIds ?? [])
  const [tourType, setTourType] = useState<TourType>(guestBookingDraft?.tourType ?? 'OVERNIGHT')
  const [checkInDate, setCheckInDate] = useState(guestBookingDraft?.checkInDate ?? tomorrow)
  const [checkOutDate, setCheckOutDate] = useState(
    guestBookingDraft?.checkOutDate ?? (() => addDays(tomorrow(), 1)),
  )
  // Main guests fill the room's pax first; extra guests come after and pay entrance.
  const [party, setParty] = useState(() => ({
    main: guestBookingDraft?.guests ?? { adults: 2, seniorsPwd: 0, children: 0 },
    extra: guestBookingDraft?.extraGuests ?? { ...noGuests },
  }))
  const mainGuests = party.main
  const extraGuests = party.extra
  const guests = useMemo(() => ({
    adults: party.main.adults + party.extra.adults,
    seniorsPwd: party.main.seniorsPwd + party.extra.seniorsPwd,
    children: party.main.children + party.extra.children,
  }), [party])
  const [availabilityResult, setAvailabilityResult] = useState<{
    key: string
    available: boolean
    pendingHold: boolean
    blocked: boolean
  } | null>(null)
  const [availabilityErrorKey, setAvailabilityErrorKey] = useState<string | null>(null)
  const [showReview, setShowReview] = useState(false)
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice>(guestBookingDraft?.paymentChoice ?? 'ONLINE')
  const [bookings, setBookings] = useState<Booking[]>([])
  const [storageError, setStorageError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [lookupReference, setLookupReference] = useState('')
  const [lookupBookingId, setLookupBookingId] = useState('')
  const [paymentSubmitting, setPaymentSubmitting] = useState(false)
  const [paymentNotification, setPaymentNotification] = useState<{ message: string; rejected: boolean; bookingId: string } | null>(null)
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null)
  const [galleryStayId, setGalleryStayId] = useState<string | null>(null)
  const { active: activeSection, scrollTo: scrollToSection } = useScrollSpy(sideNavSectionIds)
  const [sideNavOpen, setSideNavOpen] = useState(false)
  const closeSideNav = useCallback(() => setSideNavOpen(false), [])
  // "Proceed to Booking" pop-up: armed by picking a stay card, shown while browsing the stays.
  const [proceedBarArmed, setProceedBarArmed] = useState(false)
  useAnimateOnScroll()
  const scrollProgressRef = useScrollProgress<HTMLSpanElement>()
  const navRef = useRef<HTMLElement>(null)
  const navIndicatorRef = useRef<HTMLSpanElement>(null)

  // Slide the highlight bar under the active header link (positioned directly, no re-render).
  useLayoutEffect(() => {
    const place = () => {
      const nav = navRef.current
      const indicator = navIndicatorRef.current
      if (!nav || !indicator) return
      const link = activeSection ? nav.querySelector<HTMLElement>(`a[href="#${activeSection}"]`) : null
      if (!link) {
        indicator.style.opacity = '0'
        return
      }
      indicator.style.opacity = '1'
      indicator.style.width = `${link.offsetWidth}px`
      indicator.style.transform = `translateX(${link.offsetLeft}px)`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [activeSection])
  const galleryStay = accommodations.find((stay) => stay.id === galleryStayId)
  const [lookupError, setLookupError] = useState('')
  const [holdSubmitting, setHoldSubmitting] = useState(false)
  const [holdConfirmation, setHoldConfirmation] = useState<{
    bookingId: string
    referenceNumber: string
    expiresAt: string
  } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const previousPaymentStatuses = useRef<Map<string, string> | null>(null)
  const reviewButtonRef = useRef<HTMLButtonElement>(null)
  const closeReviewRef = useRef<HTMLButtonElement>(null)

  // One booking can combine several accommodations (e.g. Bahay Hapag + Balai Delnor).
  const selectedKey = selectedIds.join(',')
  const stayDays = daysBetween(checkInDate, checkOutDate)
  // Rates and maximum pax as they apply to this tour type and length (2+ days: overnight rates).
  const overnightPricing = usesOvernightRates(tourType, stayDays)
  const pricedStays = useMemo(() => priceAccommodations(accommodations, tourType, stayDays), [tourType, stayDays])
  const selectedStays = useMemo(
    () => pricedStays.filter((stay) => selectedKey.split(',').includes(stay.id)),
    [pricedStays, selectedKey],
  )
  const combinedStay = useMemo(() => combineAccommodations(selectedStays), [selectedStays])
  // Pax whose entrance the room rate includes; null when every guest pays entrance.
  const roomPax = !combinedStay.entranceFeeForAll && combinedStay.capacity > 0 ? combinedStay.capacity : null
  const mainCount = countGuests(mainGuests)
  const extraCount = countGuests(extraGuests)
  const extraEntrance = entranceRates[overnightPricing ? 'OVERNIGHT' : tourType]
  useEffect(() => {
    setParty((current) => rebalanceParty(current, roomPax))
  }, [roomPax])
  const totals = useMemo(
    () => calculateBookingTotal(selectedStays, guests, stayDays, tourType, roomPax === null ? undefined : extraGuests),
    [selectedStays, guests, stayDays, tourType, roomPax, extraGuests],
  )
  const onlineCharge = Math.round((totals.depositRequired / (1 - 0.025)) * 100) / 100
  const gatewayFeeAmount = Math.round((onlineCharge - totals.depositRequired) * 100) / 100
  const cashBalanceDue = Math.round((totals.grandTotal - totals.depositRequired) * 100) / 100
  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  // Guests may go over the rooms' pax (extra heads pay entrance), up to one booking's cap.
  const guestLimit = BOOKING_MAX_GUESTS
  const overGuestLimit = guestCount > guestLimit
  const availabilityKey = JSON.stringify([selectedKey, checkInDate, checkOutDate])
  const datesHaveSoftHold = availabilityResult?.key === availabilityKey && availabilityResult.pendingHold

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  const availabilityStatus = selectedIds.length === 0 || !checkInDate || !checkOutDate || checkOutDate <= checkInDate
    ? 'idle'
    : availabilityResult?.key === availabilityKey
      ? availabilityResult.available ? 'available' : 'unavailable'
      : availabilityErrorKey === availabilityKey ? 'error' : 'checking'

  useEffect(() => {
    try {
      sessionStorage.removeItem(GUEST_BOOKING_DRAFT_KEY)
    } catch (error) {
      console.error('Could not clear the restored guest booking details from session storage:', error)
    }
  }, [])

  useEffect(() => {
    if (!guestBookingDraft || window.location.hash !== '#booking') return
    window.requestAnimationFrame(() => {
      document.getElementById('booking')?.scrollIntoView()
    })
  }, [guestBookingDraft])

  useEffect(() => {
    if (!selectedKey || !checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      return
    }
    const controller = new AbortController()
    const key = JSON.stringify([selectedKey, checkInDate, checkOutDate])
    const check = () => {
      fetchAvailability(selectedKey.split(','), checkInDate, checkOutDate, controller.signal)
        .then(({ available, pendingHold, blocked }) => setAvailabilityResult({ key, available, pendingHold, blocked }))
        .catch(() => {
          if (!controller.signal.aborted) setAvailabilityErrorKey(key)
        })
    }
    check()
    // Re-check while the page is open, so dates freed by a cancellation (or newly
    // confirmed by someone else) show up without the guest changing anything.
    const interval = window.setInterval(check, 30_000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      controller.abort()
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [selectedKey, checkInDate, checkOutDate])

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
      if (event.key === 'Escape') closeReview()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      reviewButton?.focus()
    }
  }, [showReview])

  function closeReview() {
    setShowReview(false)
    setHoldConfirmation(null)
  }

  const changeGuestCount = (type: GuestType, delta: number, group: 'main' | 'extra' = 'main') => {
    setParty((current) => ({
      ...current,
      [group]: { ...current[group], [type]: Math.max(0, current[group][type] + delta) },
    }))
  }

  const resetAvailabilityCheck = () => {
    setAvailabilityResult(null)
    setAvailabilityErrorKey(null)
  }

  /** Adds or removes an accommodation. The guest chooses; nothing is pre-selected. */
  const toggleStay = (stayId: string) => {
    resetAvailabilityCheck()
    setSelectedIds(orderedAccommodationIds(
      selectedIds.includes(stayId) ? selectedIds.filter((id) => id !== stayId) : [...selectedIds, stayId],
    ))
  }

  // Hero slideshow "Select space": book just that accommodation, then glide to the calculator.
  const selectStayFromHero = (stayId: string) => {
    if (selectedIds.length !== 1 || selectedIds[0] !== stayId) {
      resetAvailabilityCheck()
      setSelectedIds([stayId])
    }
    scrollToSection('booking')
  }

  const signInToBook = () => {
    if (user) {
      setShowReview(true)
      return
    }
    setStorageError('')
    try {
      sessionStorage.setItem(GUEST_BOOKING_DRAFT_KEY, JSON.stringify({
        selectedIds,
        tourType,
        checkInDate,
        checkOutDate,
        guests: mainGuests,
        extraGuests,
        paymentChoice,
      }))
    } catch {
      setStorageError('Could not save your booking details. Check your browser storage settings and try again.')
      return
    }
    window.location.assign('/login?next=preview')
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
    const booking = {
      accommodationIds: selectedIds,
      tourType,
      checkInDate,
      checkOutDate,
      guests: { ...guests },
      ...(roomPax === null ? {} : { extraGuests: { ...extraGuests } }),
    }

    setPaymentSubmitting(true)
    try {
      const checkout = await createGcashCheckout(token, booking)
      setStorageError('')
      window.location.assign(checkout.checkoutUrl)
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not start GCash checkout.')
    } finally {
      setPaymentSubmitting(false)
    }
  }

  const submitPendingHold = async () => {
    if (!checkInDate || !checkOutDate || checkOutDate <= checkInDate) {
      setStorageError('Choose a check-out date after check-in.')
      return
    }
    if (!user || !token) {
      setStorageError('Sign in before holding a date.')
      return
    }
    setHoldSubmitting(true)
    try {
      const hold = await createPendingHold(token, {
        accommodationIds: selectedIds,
        tourType,
        checkInDate,
        checkOutDate,
        guests: { ...guests },
        ...(roomPax === null ? {} : { extraGuests: { ...extraGuests } }),
      })
      setStorageError('')
      setHoldConfirmation(hold)
      resetAvailabilityCheck()
      fetchCustomerBookings(token)
        .then(setBookings)
        .catch((error: unknown) => console.error('Could not refresh bookings after placing a hold:', error))
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : 'Could not create your walk-in voucher.')
    } finally {
      setHoldSubmitting(false)
    }
  }

  const findInquiry = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const found = bookings.find(
      (booking) =>
        (booking.referenceNumber.toLowerCase() === lookupReference.trim().toLowerCase() ||
          booking.id.toLowerCase() === lookupReference.trim().toLowerCase()) &&
        booking.customerContact.toLowerCase() === user?.email.toLowerCase(),
    )
    setLookupError(found ? '' : 'We couldn’t find an inquiry with that reference and contact.')
    setLookupBookingId(found?.id ?? '')
  }

  const selectCustomerBooking = (booking: Booking) => {
    setLookupReference(booking.referenceNumber)
    setLookupBookingId(booking.id)
    setLookupError('')
  }

  const lookupBooking = bookings.find((booking) => booking.id === lookupBookingId)

  return (
    <div className="site-shell">
      <AmbientAtmosphere />
      <FallingLeaves />
      <CustomerSideNav
        open={sideNavOpen}
        onClose={closeSideNav}
        activeSection={activeSection}
        onNavigate={scrollToSection}
        bookingCount={bookings.length}
        user={user ? { email: user.email, role: user.role } : null}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSignOut={() => { logout().catch((error: unknown) => setLogoutError(error instanceof Error ? error.message : 'Could not sign out.')) }}
      />
      {proceedBarArmed && selectedStays.length > 0 && activeSection === 'stays' && !sideNavOpen && !galleryStayId && (
        <ProceedBookingBar
          stayNames={selectedStays.map((stay) => stay.name)}
          onProceed={() => { setProceedBarArmed(false); scrollToSection('booking') }}
          onDismiss={() => setProceedBarArmed(false)}
        />
      )}
      <header className="site-header">
        <button type="button" className="customer-menu-button" aria-label="Open menu" aria-controls="customer-side-menu" aria-expanded={sideNavOpen} onClick={() => setSideNavOpen(true)}><Menu size={23} /></button>
        <a className="brand brand-logo" href="#home" aria-label="Tampisawan home">
          <ResortLogo className="resort-logo-navbar" />
        </a>
        <nav className="main-nav" aria-label="Main navigation" ref={navRef}>
          {navSections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={activeSection === section.id ? 'is-active' : ''}
              aria-current={activeSection === section.id ? 'location' : undefined}
              onClick={(event) => {
                event.preventDefault()
                scrollToSection(section.id)
              }}
            >
              {section.label}
            </a>
          ))}
          <span className="main-nav-indicator" ref={navIndicatorRef} aria-hidden="true" />
        </nav>
        <div className="header-actions">
          {user ? (
            <>
              <a className="header-account" href="/login">
                {user.role === 'ADMIN' && <span className="header-role-badge is-admin">Admin</span>}
                <span className="header-account-email">{user.email}</span>
              </a>
              <Tooltip label="Sign out" placement="bottom"><button className="header-signout" type="button" aria-label="Sign out" onClick={() => logout().catch((error: unknown) => setLogoutError(error instanceof Error ? error.message : 'Could not sign out.'))}><LogOut size={15} /></button></Tooltip>
            </>
          ) : null}
          <Tooltip label={theme === 'light' ? 'Switch to night mode' : 'Switch to day mode'} placement="bottom">
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === 'light' ? 'night' : 'day'} mode`}
            aria-pressed={theme === 'dark'}
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            <span>{theme === 'light' ? 'Night' : 'Day'}</span>
          </button>
          </Tooltip>
          <a className="header-cta" href={user ? '#booking' : '/login?next=preview'}>
            {user ? 'Book a tour' : 'Sign In to Book'} <ArrowUpRight size={16} />
          </a>
        </div>
        {logoutError && <p className="header-error" role="alert">{logoutError}</p>}
        <span className="nav-progress" ref={scrollProgressRef} aria-hidden="true" />
      </header>

      <main>
        <section className="hero" id="home">
          <div className="hero-copy" data-aos="fade-up">
            <span className="eyebrow"><Sparkles size={14} /> {user ? 'YOUR PRIVATE POOL ESCAPE' : 'GUEST PREVIEW MODE'}</span>
            <ResortLogo className="resort-logo-hero" />
            <h1>Slow down.<br />Stay a little <em>longer.</em></h1>
            <p>
              Make room for day tours, night swims, and overnight stays at
              Tampisawan.
            </p>
            <div className="hero-actions">
              <a className="button button-light" href="#booking">
                Preview Resort &amp; Rates <ArrowDown size={16} />
              </a>
              <span className="hero-hours"><Clock3 size={16} /> Day tours, night tours, and overnight stays</span>
            </div>
            <div className="hero-trust">
              <span><Check size={15} /> Private pool</span>
              <span><Check size={15} /> Spaces for every group</span>
              <span><Check size={15} /> Easy rate preview</span>
            </div>
          </div>
          <HeroShowcase onSelectStay={selectStayFromHero} onPlanVisit={() => scrollToSection('booking')} />
          <div className="hero-scroll"><span /> SCROLL TO EXPLORE</div>
        </section>

        <section className="intro-strip" aria-label="Stay details">
          <div data-aos="fade-up"><span className="strip-icon"><Clock3 size={19} /></span><span><b>Flexible tour times</b><small>Day, night, or overnight</small></span></div>
          <div data-aos="fade-up" data-aos-delay="100"><span className="strip-icon"><Users size={19} /></span><span><b>Up to 20 guests</b><small>Room and event space capacities</small></span></div>
          <div data-aos="fade-up" data-aos-delay="200"><span className="strip-icon"><Waves size={19} /></span><span><b>Poolside moments</b><small>Bring your favorite people</small></span></div>
          <a href="#rates" data-aos="fade-up" data-aos-delay="300">See all rates <ArrowRight size={16} /></a>
        </section>

        <section className="stays-section section-wrap" id="stays">
          <div className="section-heading" data-aos="fade-up">
            <div>
              <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> FIND YOUR SPACE</span>
              <h2>Make yourself <em>at home.</em></h2>
              <p>Pick the place that fits your people, or combine several in one booking. Every stay is yours to make special.</p>
            </div>
            <a className="text-link" href="#rates">View rate details <ArrowUpRight size={16} /></a>
          </div>
          <div className="stay-grid">
            {accommodations.map((stay, index) => {
              const isSelected = selectedIds.includes(stay.id)
              return (
                <article className={`stay-card ${stay.exclusiveWholeResort ? 'is-exclusive' : 'is-shared'} ${isSelected ? 'is-selected' : ''}`} key={stay.id} data-aos="fade-up" data-aos-delay={(index % 3) * 100}>
                  <div className={`stay-art stay-art-${index + 1} ${stay.photos.length ? 'has-photo' : ''}`}>
                    {stay.photos[0] && <img className="stay-art-photo" src={stay.photos[0].src} alt="" loading="lazy" decoding="async" />}
                    <button
                      type="button"
                      className="stay-photos-button"
                      aria-label={`View inside and outside photos of ${stay.name}`}
                      onClick={() => setGalleryStayId(stay.id)}
                    >
                      <Images size={13} /> <span className="photos-label-full">View photos</span><span className="photos-label-short">Photos</span>{stay.photos.length > 0 && <span className="stay-photos-count">{stay.photos.length}</span>}
                    </button>
                    <span className="stay-art-icon">
                      {index === 3 || index === 7 ? <TentTree size={29} /> : index === 2 || index === 5 ? <Compass size={29} /> : <House size={29} />}
                    </span>
                    <Tooltip label={`Maximum ${stay.capacity} guests (pax) for ${stay.name}. Combine stays for bigger groups.`}>
                      <span className="stay-capacity" tabIndex={0}><Users size={14} /> Up to {stay.capacity}{stay.overnightCapacity ? ` (${stay.overnightCapacity} overnight)` : ''}</span>
                    </Tooltip>
                    {stay.entranceFeeForAll && (
                      <Tooltip label="Every guest pays the entrance fee here, not only those above capacity.">
                        <span className="fee-pill" tabIndex={0}>Entrance fee applies</span>
                      </Tooltip>
                    )}
                    {stay.exclusiveWholeResort ? (
                      <span className="gold-glass-badge"><Sparkles size={12} /> <span className="badge-label-full">Exclusive Solo Resort</span><span className="badge-label-short">Exclusive</span></span>
                    ) : (
                      <span className="shared-pool-badge"><Waves size={12} /> <span className="badge-label-full">Shared Pool Access</span><span className="badge-label-short">Shared Pool</span></span>
                    )}
                  </div>
                  <div className="stay-card-body">
                    <div className="stay-title-row">
                      <div>
                        <h3>{stay.name}</h3>
                        <span className="stay-subtitle">{stay.category}</span>
                      </div>
                      <div className="stay-price">
                        <strong>{formatPeso(stay.overnightRate)}</strong><small>overnight · 22 hrs</small>
                        <span className="stay-price-tour"><Sun size={11} aria-hidden="true" /> Day tour <b>{formatPeso(stay.baseRate)}</b></span>
                        <span className="stay-price-tour"><Moon size={11} aria-hidden="true" /> Night tour <b>{formatPeso(stay.baseRate)}</b></span>
                      </div>
                    </div>
                    <ul className="feature-list">
                      {stay.features.slice(0, 3).map((feature) => <li key={feature}><Check size={13} /> {feature}</li>)}
                    </ul>
                    {stay.exclusiveWholeResort ? (
                      <div className="exclusive-resort-note gold-glass-callout">
                        <ShieldCheck size={16} />
                        <span>
                          <b>Exclusive / Solo Use of Entire Resort &amp; Private Pool</b>
                          <small>Includes 100% private solo use of the whole resort and private pool. Once confirmed, no other guests or bookings can check in during your dates.</small>
                        </span>
                      </div>
                    ) : (
                      <div className="shared-pool-note shared-pool-callout">
                        <Waves size={15} />
                        <span>
                          <b>Standard Shared-Pool Access</b>
                          <small>{stay.accessDescription}</small>
                        </span>
                      </div>
                    )}
                    <button
                      className={`select-stay ${isSelected ? 'selected' : ''}`}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => { toggleStay(stay.id); setProceedBarArmed(true) }}
                    >
                      {isSelected
                        ? <><Check size={15} /> Added · Remove</>
                        : <>Add to booking <Plus size={15} /></>}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="booking-section" id="booking">
          <div className="booking-inner section-wrap">
            <div className="booking-intro" data-aos="fade-right">
              <span className="eyebrow eyebrow-light"><span className="eyebrow-dot" /> YOUR STAY, YOUR WAY</span>
              <h2>Plan your<br /><em>poolside escape.</em></h2>
              <p>Choose a tour type, one or more accommodations, dates, and guests. Accommodation and applicable excess-guest entrance fees are charged for each booked day.</p>
              <div className="booking-note"><ShieldCheck size={18} /><span><b>Preview dates and rates</b><small>Availability is checked against confirmed bookings; payment verification secures a stay.</small></span></div>
            </div>

            <div className="booking-card" data-aos="fade-up" data-aos-delay="150">
              <div className="booking-card-head">
                <div><span className="form-step">01</span><div><h3>Your booking details</h3><p>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</p></div></div>
                <span className="booking-tag"><Leaf size={13} /> TAMPISAWAN</span>
              </div>
              <fieldset className="form-field tour-picker">
                <legend>Tour type</legend>
                <div className="tour-options">
                  {(['DAY_TOUR', 'NIGHT_TOUR', 'OVERNIGHT'] as TourType[]).map((type) => (
                    <label className={`tour-option ${tourType === type ? 'is-checked' : ''}`} key={type}>
                      <input type="radio" name="tour-type" value={type} checked={tourType === type} onChange={() => setTourType(type)} />
                      {type === 'DAY_TOUR' ? <Sun size={16} /> : type === 'NIGHT_TOUR' ? <Moon size={16} /> : <Clock3 size={16} />}
                      <b>{tourDetails[type].label}</b>
                      <small>{tourDetails[type].checkIn}–{tourDetails[type].checkOut}</small>
                      <small className="tour-option-fee">Entrance {formatPeso(entranceRates[type].adults)} adult · {formatPeso(entranceRates[type].children)} senior/child</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="form-field stay-picker">
                <legend>Accommodations <span>Select one or more</span></legend>
                <div className="stay-options">
                  {pricedStays.map((stay) => {
                    const checked = selectedIds.includes(stay.id)
                    return (
                      <label className={`stay-option ${checked ? 'is-checked' : ''}`} key={stay.id}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStay(stay.id)}
                        />
                        <span className="stay-option-box" aria-hidden="true">{checked && <Check size={11} strokeWidth={3} />}</span>
                        <span className="stay-option-name">
                          {stay.name}
                          <small className="stay-option-pax"><Users size={10} aria-hidden="true" /> Up to {stay.capacity} pax{stay.exclusiveWholeResort && <em> · Whole resort</em>}</small>
                        </span>
                        <span className="stay-option-price">{formatPeso(stay.baseRate)}<small>{overnightPricing ? '/22 hrs' : tourType === 'NIGHT_TOUR' ? '/night tour' : '/day tour'}</small></span>
                      </label>
                    )
                  })}
                </div>
                <small className="field-hint">
                  {selectedStays.length === 0
                    ? <b>Select at least one accommodation to continue.</b>
                    : <>{selectedStays.length} selected · <b>room for {combinedStay.maxGuests} pax</b>
                      {selectedStays.length > 1 && ` (${selectedStays.map((stay) => stay.capacity).join(' + ')})`}</>}
                </small>
                <small className="field-hint tour-rate-hint">
                  {overnightPricing
                    ? <>Overnight rate{tourType === 'OVERNIGHT' ? ' (22 hours)' : ` for each of the ${stayDays} days`}: entrance is included for up to the room&apos;s pax; each extra guest pays {formatPeso(entranceRates.OVERNIGHT.adults)} per adult and {formatPeso(entranceRates.OVERNIGHT.children)} per senior/PWD/child (Gazebo, Calesa Tables, and Kubo ni Gerrant: every guest).</>
                    : <>{tourDetails[tourType].label} ({tourDetails[tourType].checkIn}–{tourDetails[tourType].checkOut}): the room rate includes entrance for up to the room&apos;s pax; each extra guest pays {formatPeso(entranceRates[tourType].adults)} per adult and {formatPeso(entranceRates[tourType].children)} per senior/PWD/child (Gazebo, Calesa Tables, and Kubo ni Gerrant: every guest). 2 or more days uses the overnight rate.</>}
                </small>
                {selectedStays.length === 0 ? null : combinedStay.exclusiveWholeResort ? (
                  <div className="exclusive-resort-note booking-exclusive-note gold-glass-callout">
                    <ShieldCheck size={16} />
                    <span>
                      <b>Exclusive / Solo Use of Entire Resort &amp; Private Pool</b>
                      <small>
                        {selectedStays.length > 1
                          ? 'Your selection includes a whole-resort stay. Once confirmed, the other accommodations you picked are yours too, and no other customers can book or check in during your dates.'
                          : 'After this booking is confirmed, no other customers can book or check in during your reserved dates.'}
                      </small>
                    </span>
                  </div>
                ) : (
                  <div className="shared-pool-note booking-exclusive-note shared-pool-callout">
                    <Waves size={15} />
                    <span>
                      <b>Standard Shared-Pool Access</b>
                      <small>{selectedStays.length > 1 ? 'Your accommodations include standard shared access to the resort pool and grounds alongside other guests.' : selectedStays[0]?.accessDescription}</small>
                    </span>
                  </div>
                )}
              </fieldset>
              <div className="date-fields">
                <div className="form-field">
                  <label htmlFor="check-in">Check-in</label>
                  <input id="check-in" type="date" min={tomorrow()} value={checkInDate} onChange={(event) => {
                    const nextCheckIn = event.target.value
                    resetAvailabilityCheck()
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
                    onChange={(event) => {
                      resetAvailabilityCheck()
                      setCheckOutDate(tourType === 'DAY_TOUR' ? addDays(event.target.value, 1) : event.target.value)
                    }}
                  />
                  <small className="field-hint">{tourDetails[tourType].checkOut} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</small>
                </div>
              </div>
              <p className={`availability-status availability-${availabilityStatus}`} role="status" aria-live="polite">
                {availabilityStatus === 'checking'
                  ? 'Checking these dates…'
                  : availabilityStatus === 'available'
                    ? datesHaveSoftHold
                      ? 'Still open: another guest has a walk-in voucher for these dates, but vouchers don\'t reserve them. The first booking confirmed gets the dates.'
                      : combinedStay.exclusiveWholeResort
                        ? 'Dates look available. The whole resort is reserved for you once this booking is confirmed.'
                        : 'No confirmed booking overlaps these dates.'
                    : availabilityStatus === 'unavailable'
                      ? availabilityResult?.blocked
                        ? 'The resort is closed on these dates (maintenance or private use). Please choose other dates.'
                        : selectedStays.length > 1
                        ? 'At least one of your accommodations is already confirmed for these dates. Remove it or choose another range.'
                        : 'These dates overlap with a confirmed booking. Choose another range.'
                      : availabilityStatus === 'error'
                        ? 'Availability could not be checked. Please contact the resort before booking.'
                        : selectedStays.length === 0
                          ? 'Select an accommodation to check these dates.'
                          : 'Choose a valid date range to check availability.'}
              </p>
              <p className="fcfs-note">
                <Info size={14} aria-hidden="true" />
                <span>
                  <b>First come, first served.</b> Dates stay open to everyone until a booking is confirmed: by a verified 50% GCash deposit, or by cash received at the resort. Inquiries and walk-in vouchers don&apos;t reserve a date.
                </span>
              </p>
              <div className="form-field guest-field">
                <div className="guest-heading"><label>Guests</label><span>{guestCount} {guestCount === 1 ? 'guest' : 'guests'}{roomPax !== null && extraCount > 0 ? ` · ${mainCount} in the room + ${extraCount} extra` : ''}</span></div>
                {roomPax !== null && (
                  <div className="guest-group-heading">
                    <b>1. In the room</b>
                    <span>{mainCount} of {roomPax} pax · entrance included</span>
                  </div>
                )}
                <div className="guest-list">
                  {(Object.keys(guestLabels) as GuestType[]).map((type) => {
                    const roomFull = roomPax !== null && mainCount >= roomPax
                    const addLabel = guestCount >= guestLimit
                      ? `One booking can have up to ${guestLimit} guests.`
                      : roomFull ? 'The room is full. Add more people under Extra guests.' : ''
                    const removeLocked = extraCount > 0 && roomPax !== null
                    return (
                      <div className="guest-row" key={type}>
                        <span><b>{guestLabels[type].title}</b><small>{guestLabels[type].detail}</small></span>
                        <div className="guest-stepper">
                          <Tooltip label={removeLocked && mainGuests[type] > 0 ? 'Remove the extra guests first.' : ''} wrap>
                            <button type="button" aria-label={`Remove one ${guestLabels[type].title.toLowerCase()} from the room`} disabled={removeLocked || mainGuests[type] === 0 || (type === 'adults' && mainGuests.adults === 1)} onClick={() => changeGuestCount(type, -1)}><Minus size={14} /></button>
                          </Tooltip>
                          <strong>{mainGuests[type]}</strong>
                          <Tooltip label={addLabel} wrap>
                            <button type="button" aria-label={`Add one ${guestLabels[type].title.toLowerCase()} to the room`} disabled={guestCount >= guestLimit || roomFull} onClick={() => changeGuestCount(type, 1)}><Plus size={14} /></button>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </div>
                {roomPax !== null && (
                  <>
                    <div className="guest-group-heading is-extra">
                      <b>2. Extra guests</b>
                      <span>Pay entrance: {formatPeso(extraEntrance.adults)} adult · {formatPeso(extraEntrance.children)} senior/child{stayDays > 1 ? ' per day' : ''}</span>
                    </div>
                    {mainCount < roomPax ? (
                      <p className="guest-extra-locked"><Info size={13} aria-hidden="true" /> Fill the {roomPax} {roomPax === 1 ? 'spot' : 'spots'} in the room first ({roomPax - mainCount} left). Then you can add extra guests here.</p>
                    ) : (
                      <div className="guest-list is-extra">
                        {(Object.keys(guestLabels) as GuestType[]).map((type) => (
                          <div className="guest-row" key={type}>
                            <span><b>Extra {type === 'seniorsPwd' ? 'senior / PWD' : guestLabels[type].title.toLowerCase()}</b><small>+{formatPeso(extraEntrance[type])} each{stayDays > 1 ? ' per day' : ''}</small></span>
                            <div className="guest-stepper">
                              <button type="button" aria-label={`Remove one extra ${guestLabels[type].title.toLowerCase()}`} disabled={extraGuests[type] === 0} onClick={() => changeGuestCount(type, -1, 'extra')}><Minus size={14} /></button>
                              <strong>{extraGuests[type]}</strong>
                              <Tooltip label={guestCount >= guestLimit ? `One booking can have up to ${guestLimit} guests.` : ''} wrap>
                                <button type="button" aria-label={`Add one extra ${guestLabels[type].title.toLowerCase()}`} disabled={guestCount >= guestLimit} onClick={() => changeGuestCount(type, 1, 'extra')}><Plus size={14} /></button>
                              </Tooltip>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {overGuestLimit ? (
                  <p className="pax-limit-note is-over" role="alert">
                    <AlertTriangle size={14} aria-hidden="true" />
                    <span>One booking can have up to {guestLimit} guests. For a bigger group, please contact the resort.</span>
                  </p>
                ) : selectedStays.length > 0 && roomPax === null && guestCount > combinedStay.maxGuests ? (
                  <p className="pax-limit-note">
                    <Info size={14} aria-hidden="true" />
                    <span>{guestCount - combinedStay.maxGuests} more than the room&apos;s {combinedStay.maxGuests} pax. That&apos;s fine: every guest pays the entrance fee, already in your total.</span>
                  </p>
                ) : null}
              </div>

              <div className="estimate-box">
                <div className="estimate-heading"><span><Sparkles size={15} /> YOUR ESTIMATED TOTAL</span><small>PHP</small></div>
                {selectedStays.length === 0 ? (
                  <p className="estimate-empty"><Info size={16} aria-hidden="true" /> Select an accommodation to see your total and payment options.</p>
                ) : (<>
                {selectedStays.map((stay) => (
                  <div className="estimate-line" key={stay.id}><span>{stay.name} (room for {stay.capacity}) · {stayDays} {stayDays === 1 ? 'day' : 'days'} × {formatPeso(stay.baseRate)}{overnightPricing && tourType !== 'OVERNIGHT' ? ' (overnight rate)' : ''}</span><b>{formatPeso(stay.baseRate * totals.stayDays)}</b></div>
                ))}
                <div className="estimate-line"><span>{overnightPricing && tourType !== 'NIGHT_TOUR' ? 'Overnight' : tourDetails[tourType].label} entrance fee · {totals.chargeableGuests} {combinedStay.entranceFeeForAll ? 'guest' : 'extra guest'}{totals.chargeableGuests === 1 ? '' : 's'} × {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formatPeso(totals.entranceFees)}</b></div>
                <div className="estimate-divider" />
                <div className="estimate-line estimate-base"><span>Base Resort Rate (net to resort)</span><b>{formatPeso(totals.grandTotal)}</b></div>
                {/* Two ways to pay, each with its own total */}
                <p className="estimate-choose">Choose how you&apos;d like to pay:</p>
                <div className="estimate-options" role="radiogroup" aria-label="How would you like to pay?">
                  <div
                    className={`estimate-option is-online${paymentChoice === 'ONLINE' ? ' is-selected' : ''}`}
                    role="radio"
                    aria-checked={paymentChoice === 'ONLINE'}
                    aria-label="Online reservation with a GCash deposit"
                    tabIndex={0}
                    onClick={() => setPaymentChoice('ONLINE')}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPaymentChoice('ONLINE') } }}
                  >
                    <header><span className="estimate-option-radio" aria-hidden="true">{paymentChoice === 'ONLINE' && <Check size={12} strokeWidth={3} />}</span><b>1. Online Reservation · GCash</b><small>Reserves and blocks your dates once the payment is verified.</small></header>
                    <div className="estimate-line"><span>50% Reservation Deposit</span><b>{formatPeso(totals.depositRequired)}</b></div>
                    <div className="estimate-line"><span>GCash Gateway Fee (2.5%)</span><b>{formatPeso(gatewayFeeAmount)}</b></div>
                    <div className="estimate-total"><span>Pay now via GCash</span><b>{formatPeso(onlineCharge)}</b></div>
                    <div className="deposit-row"><span>Remaining 50% cash at check-in</span><b>{formatPeso(cashBalanceDue)}</b></div>
                    <div className="deposit-row estimate-option-sum"><span>Estimated total (incl. GCash fee)</span><b>{formatPeso(totals.grandTotal + gatewayFeeAmount)}</b></div>
                  </div>
                  <div
                    className={`estimate-option is-walkin${paymentChoice === 'WALKIN' ? ' is-selected' : ''}`}
                    role="radio"
                    aria-checked={paymentChoice === 'WALKIN'}
                    aria-label="Walk-in, pay cash at the resort"
                    tabIndex={0}
                    onClick={() => setPaymentChoice('WALKIN')}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPaymentChoice('WALKIN') } }}
                  >
                    <header><span className="estimate-option-radio" aria-hidden="true">{paymentChoice === 'WALKIN' && <Check size={12} strokeWidth={3} />}</span><b>2. Walk-In · Cash</b><small>No reservation; same-day availability is checked on arrival.</small></header>
                    <div className="estimate-line"><span>Online / GCash fee</span><b>{formatPeso(0)}</b></div>
                    <div className="estimate-total"><span>Pay in cash on arrival</span><b>{formatPeso(totals.grandTotal)}</b></div>
                    <div className="deposit-row estimate-option-sum"><span>Estimated total (cash)</span><b>{formatPeso(totals.grandTotal)}</b></div>
                  </div>
                </div>
                <p className="estimate-disclaimer">
                  {combinedStay.entranceFeeForAll
                    ? `Entrance fees apply to every guest for each of the ${stayDays} ${stayDays === 1 ? 'day' : 'days'}.`
                    : `Entrance fees apply per day to guests above the ${combinedStay.capacity}-guest ${selectedStays.length > 1 ? 'combined capacity' : 'capacity'}.`}
                  {' '}The gateway fee is shown separately from the resort rate.
                </p>
                </>)}
              </div>
              {storageError && <p className="customer-error" role="alert">{storageError}</p>}
              <button ref={reviewButtonRef} className="review-button" type="button" onClick={signInToBook} disabled={selectedStays.length === 0 || !checkInDate || !checkOutDate || checkOutDate <= checkInDate || guestCount === 0 || overGuestLimit || availabilityStatus === 'checking' || availabilityStatus === 'unavailable'}>
                {selectedStays.length === 0
                  ? 'Select an accommodation first'
                  : user
                    ? paymentChoice === 'ONLINE' ? 'Review & pay deposit via GCash' : 'Review walk-in & get voucher'
                    : 'Sign In to Book'} <ArrowRight size={17} />
              </button>
              <p className="form-footnote">
                {paymentChoice === 'ONLINE'
                  ? 'Secure GCash checkout opens after you sign in. The booking is confirmed only after HitPay verifies payment.'
                  : 'After you sign in, you get a walk-in voucher with a reference number. Pay in cash at the resort; dates are confirmed once the cash is received.'}
              </p>
            </div>
          </div>
        </section>

        <section className="customer-followup section-wrap" id="my-inquiry">
          <div className="customer-followup-copy" data-aos="fade-right">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> CUSTOMER INQUIRY</span>
            <h2>Already sent an<br /><em>inquiry?</em></h2>
            <p>Check whether the resort has verified your payment. If you paid a downpayment, submit the remaining balance before checkout.</p>
            <div className="followup-note"><ShieldCheck size={17} /> Inquiries and payment reports are saved to the resort database.</div>
          </div>
          <div className="followup-card" data-aos="fade-up" data-aos-delay="150">
            {paymentNotification && (
              <div className={`payment-notification ${paymentNotification.rejected ? 'is-rejected' : ''}`} role={paymentNotification.rejected ? 'alert' : 'status'}>
                {paymentNotification.rejected ? <AlertTriangle size={16} /> : <Check size={16} />}
                <span>{paymentNotification.message}</span>
                <button type="button" aria-label="Dismiss notification" onClick={() => setPaymentNotification(null)}><X size={14} /></button>
              </div>
            )}
            {storageError && <p className="customer-error" role="alert">{storageError}</p>}
            {user && (
              <div className="customer-bookings">
                <div className="customer-bookings-heading">
                  <h3>Your bookings</h3>
                  <p>Review payment status, reference numbers, and digital receipts.</p>
                </div>
                {bookings.length === 0 ? (
                  <p className="customer-bookings-empty">Your bookings and payment options will appear here after you send an inquiry.</p>
                ) : bookings.map((booking) => {
                  const balance = Math.max(0, booking.estimatedTotal - booking.paidAmount)
                  const lastRejectedPayment = [...booking.payments].reverse().find((payment) => payment.status === 'NOT_RECEIVED')
                  return (
                    <article className="customer-booking-option" key={booking.id}>
                      <div>
                        <b>{booking.accommodationName}</b>
                        <small>{tourDetails[booking.tourType].label} · {formattedDate(booking.checkInDate)} – {formattedDate(displayCheckoutDate(booking.checkOutDate, booking.tourType))}</small>
                        <small>Reference: {booking.referenceNumber}</small>
                        {lastRejectedPayment && booking.paymentStatus !== 'PENDING_REVIEW' && (
                          <span className="customer-booking-warning" role="alert">
                            The admin did not receive your {formatPeso(lastRejectedPayment.amount)} payment. Please try again.
                          </span>
                        )}
                        <span className={booking.status === 'DATE_UNAVAILABLE' || booking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'customer-date-unavailable' : booking.status === 'PENDING_HOLD' ? 'customer-hold-status' : ''}>
                          {booking.status === 'PENDING_HOLD'
                            ? isActiveHold(booking, now)
                              ? `Walk-in voucher · valid for ${formatHoldTimeLeft(holdMillisecondsLeft(booking.expiresAt, now))} · pay cash at the resort, or secure it now with GCash`
                              : 'Pending hold expired · dates released'
                            : booking.status === 'EXPIRED'
                            ? booking.paymentTier === 'ONLINE_GCASH_RESERVATION'
                              ? 'GCash checkout not finished · no payment received. Book again to reserve these dates.'
                              : 'Voucher expired after the check-in date · dates released'
                            : booking.status === 'CANCELLED_BY_GCASH_PRIORITY'
                            ? 'Hold released · another guest\'s booking was confirmed first'
                            : booking.status === 'DATE_UNAVAILABLE'
                            ? 'Payment received, but dates were secured by an earlier-verified booking. The resort will contact you about next steps.'
                            : booking.paymentStatus === 'PENDING_REVIEW'
                            ? 'Payment awaiting admin review'
                            : booking.paymentStatus === 'PAID' || booking.paymentStatus === 'PAID_CASH'
                              ? 'Fully paid'
                              : booking.paymentTier === 'ONLINE_GCASH_RESERVATION' && booking.gatewayPaymentId
                                ? `GCash deposit confirmed · ${formatPeso(booking.baseDepositAmount)} cash balance due at check-in`
                                : booking.paymentTier === 'ONLINE_GCASH_RESERVATION'
                                  ? `GCash payment not confirmed · due now ${formatPeso(booking.totalOnlinePaid)}`
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
                      <button type="button" className="customer-booking-view-button" onClick={() => { selectCustomerBooking(booking); setReceiptBooking(booking) }}>
                        {booking.paymentTier === 'PENDING_CASH_INQUIRY' ? 'View voucher' : 'View receipt'} <ArrowRight size={14} />
                      </button>
                    </article>
                  )
                })}
              </div>
            )}
            {user ? <form className="lookup-form" onSubmit={findInquiry}>
              <h3>Check your inquiry</h3>
              <label htmlFor="lookup-reference">Inquiry reference</label>
              <input id="lookup-reference" value={lookupReference} onChange={(event) => setLookupReference(event.target.value)} placeholder="e.g. TRP-GCASH-20261115-8492" required />
              <label htmlFor="lookup-contact">Phone or email used on the request</label>
              <input id="lookup-contact" value={user.email || user.username} placeholder="Your account" readOnly required />
              <button className="review-button" type="submit">Find inquiry <ArrowRight size={16} /></button>
              {lookupError && <p className="customer-error" role="alert">{lookupError}</p>}
            </form> : <div className="lookup-signin"><p>Sign in with the account used for your inquiry to check its status or report a payment.</p><a className="review-button" href="/login">Sign in <ArrowRight size={16} /></a></div>}
            {user && lookupBooking && (
              <div className="lookup-result">
                <div className="lookup-result-top">
                  <span><b>{lookupBooking.accommodationName}</b><small>{tourDetails[lookupBooking.tourType].label} · {formattedDate(lookupBooking.checkInDate)} – {formattedDate(displayCheckoutDate(lookupBooking.checkOutDate, lookupBooking.tourType))} · {lookupBooking.guestCount} guests</small></span>
                  <span className={`status-badge status-${lookupBooking.status.toLowerCase()}`}>{lookupBooking.status === 'PENDING' ? 'Under review' : lookupBooking.status === 'CONFIRMED' ? 'Confirmed' : lookupBooking.status === 'DATE_UNAVAILABLE' ? 'Dates unavailable' : lookupBooking.status === 'PENDING_HOLD' ? 'Walk-in voucher' : lookupBooking.status === 'EXPIRED' ? (lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? 'Checkout not finished' : 'Voucher expired') : lookupBooking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'Hold released' : 'Declined'}</span>
                </div>
                <p className="lookup-payment-state"><CircleDollarSign size={15} /> {lookupBooking.status === 'PENDING_HOLD' ? (isActiveHold(lookupBooking, now) ? `Heads-up hold only (first-come, first-served). It expires in ${formatHoldTimeLeft(holdMillisecondsLeft(lookupBooking.expiresAt, now))}. Pay ${formatPeso(lookupBooking.baseResortPrice)} in cash at the resort before then, or secure the date now with the GCash deposit.` : 'This pending hold has expired and the dates were released.') : lookupBooking.status === 'EXPIRED' ? (lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? 'This GCash checkout was not finished, so no payment was received. Book again to reserve these dates.' : 'This voucher expired after the check-in date without payment, so the dates were released.') : lookupBooking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'Another guest\'s booking for these dates was confirmed first (first come, first served), so this unpaid hold was released.' : lookupBooking.status === 'DATE_UNAVAILABLE' ? `Your payment of ${formatPeso(lookupBooking.paidAmount)} was received, but another confirmed booking secured these dates first. The resort will contact you to arrange a refund or discuss alternatives.` : lookupBooking.status === 'CANCELLED' ? 'This booking was cancelled by the resort.' : lookupBooking.paymentStatus === 'PAID_CASH' ? 'Walk-in cash payment received in full. Your booking is confirmed.' : lookupBooking.paymentStatus === 'PAID' ? 'Full payment verified. Your booking is successful.' : lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' && lookupBooking.gatewayPaymentId ? `GCash payment confirmed. The remaining ${formatPeso(Math.max(0, lookupBooking.baseResortPrice - lookupBooking.paidAmount))} base balance is due in cash at check-in.` : lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? `GCash payment is awaiting HitPay confirmation. Total due now: ${formatPeso(lookupBooking.totalOnlinePaid)}.` : lookupBooking.paymentStatus === 'PENDING_REVIEW' ? 'Your manual payment proof is waiting for admin review.' : lookupBooking.paymentStatus === 'NOT_PAID' ? 'The payment was not confirmed.' : 'Your booking is waiting for payment confirmation.'}</p>
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
                <button className="customer-booking-view-button" type="button" onClick={() => setReceiptBooking(lookupBooking)}>View official receipt <ArrowRight size={14} /></button>
              </div>
            )}
          </div>
        </section>

        <section className="amenities-section section-wrap" id="amenities">
          <div className="amenities-copy" data-aos="fade-right">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> LITTLE EXTRAS, BIG MEMORIES</span>
            <h2>More time for<br /><em>the good stuff.</em></h2>
            <p>Take a dip, start a friendly match, or make an evening of it. Enjoy these shared amenities during your stay.</p>
            <a className="text-link" href="#booking">Start planning <ArrowUpRight size={16} /></a>
          </div>
          <div className="amenity-panel" data-aos="fade-left" data-aos-delay="150">
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
            <div className="rates-heading" data-aos="fade-up">
              <h2>Simple rates.<br /><em>More good times.</em></h2>
              <p>Choose a Day Tour (7:00 AM–5:00 PM), Night Tour (7:00 PM–6:00 AM), or Overnight stay (22 hours, 2:00 PM–12:00 NN). Day and Night Tours share one room rate, and Overnight has its own. Every rate includes entrance for up to the room&apos;s pax; extra guests pay that tour&apos;s entrance fee. Each stay card shows both rates.</p>
            </div>
            <div className="rate-details">
              <div className="rate-detail-card rate-day" data-aos="fade-up" data-aos-delay="0">
                <span className="rate-detail-icon"><Sun size={19} /></span>
                <div>
                  <b>Day Tour entrance</b>
                  <span className="rate-time">7:00 AM–5:00 PM</span>
                  <ul className="rate-prices">
                    <li><span>Adult</span><strong>₱150</strong></li>
                    <li><span>Senior / PWD</span><strong>₱120</strong></li>
                    <li><span>Child (10 years old and below)</span><strong>₱120</strong></li>
                  </ul>
                  <p className="rate-detail-note">Entrance is included for up to the room&apos;s pax; extra guests pay these rates. Example: Abelyn&apos;s Cabin Glass Day Tour is ₱6,000 for up to 8 guests, plus ₱150 for each extra adult.</p>
                </div>
              </div>
              <div className="rate-detail-card rate-night" data-aos="fade-up" data-aos-delay="100">
                <span className="rate-detail-icon"><Moon size={19} /></span>
                <div>
                  <b>Night Tour entrance</b>
                  <span className="rate-time">7:00 PM–6:00 AM</span>
                  <ul className="rate-prices">
                    <li><span>Adult</span><strong>₱250</strong></li>
                    <li><span>Senior / PWD</span><strong>₱150</strong></li>
                    <li><span>Child (10 years old and below)</span><strong>₱150</strong></li>
                  </ul>
                  <p className="rate-detail-note">Night Tour and Overnight: entrance is included for up to the room&apos;s pax; extra guests pay these rates. Example: Abelyn&apos;s Cabin Glass Night Tour is ₱6,000 for up to 8 guests, plus ₱250 for each extra adult.</p>
                </div>
              </div>
              <div className="rate-detail-card rate-pax" data-aos="fade-up" data-aos-delay="200">
                <span className="rate-detail-icon"><ShieldCheck size={19} /></span>
                <div>
                  <b>Maximum pax</b>
                  <ul className="rate-pax-list">
                    {accommodations.map((stay) => <li key={stay.id}><span>{stay.name}</span><strong>{stay.capacity}{stay.overnightCapacity ? <small> ({stay.overnightCapacity} overnight)</small> : null}</strong></li>)}
                  </ul>
                  <p>Need more room? Combine accommodations in one booking. Gazebo, Calesa Tables, and Kubo ni Gerrant have entrance fees for all guests.</p>
                </div>
              </div>
            </div>
            <p className="rates-caveat" data-aos="fade-up">Day and Night Tours (one day) use the same room rate. Overnight stays (22 hours) and every booking of 2 or more days use the overnight rate for each day; for example, Abelyn's Cabin Glass for 3 days is 3 × ₱7,500 = ₱22,500. Every rate includes entrance for up to the room's pax: guests fill the room first, and each extra guest pays that tour's entrance fee (Day Tour ₱150 adult, ₱120 senior/child; Night Tour and Overnight ₱250 adult, ₱150 senior/child); Gazebo, Calesa Tables, and Kubo ni Gerrant charge entrance for every guest. Groups bigger than the room's pax are welcome, up to 100 guests per booking. Please confirm availability and final charges with Tampisawan before payment.</p>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand footer-brand" href="#home" aria-label="Tampisawan home">
          <ResortLogo className="resort-logo-footer" />
        </a>
        <span className="footer-note">Make space for a little getaway.</span>
        <a className="footer-top" href="#home">Back to top <ArrowUpRight size={15} /></a>
      </footer>

      {showReview && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeReview() }}>
          <section className="review-modal inquiry-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
            <button ref={closeReviewRef} className="modal-close" type="button" aria-label="Close preview" onClick={closeReview}><X size={19} /></button>
            {holdConfirmation ? (() => {
              const heldBooking = bookings.find((booking) => booking.id === holdConfirmation.bookingId)
              return (
                <div className="hold-confirmation">
                  <span className="modal-icon hold-icon"><Hourglass size={22} /></span>
                  <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> WALK-IN CONFIRMATION</span>
                  <h2 id="review-title">You&apos;re set for<br /><em>a walk-in.</em></h2>
                  <p className="modal-copy">We let the resort know you&apos;re coming and paying in cash. Show this reference or your voucher at the resort.</p>
                  <div className="hold-reference">
                    <span>Walk-in reference</span>
                    <b>{holdConfirmation.referenceNumber}</b>
                  </div>
                  <div className="hold-timer-card">
                    <span>Voucher valid for</span>
                    <HoldCountdown expiresAt={holdConfirmation.expiresAt} />
                    <small>{new Date(holdConfirmation.expiresAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} (Philippine time)</small>
                  </div>
                  <div className="review-details">
                    <div><span>{selectedStays.length > 1 ? 'Accommodations' : 'Accommodation'}</span><b>{combinedStay.name}</b></div>
                    <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
                    <div className="review-total"><span>Cash due at the resort</span><b>{formatPeso(totals.grandTotal)}</b></div>
                  </div>
                  <p className="hold-disclaimer">
                    First come, first served: a walk-in voucher does not reserve the date. The dates stay open to other guests until a booking is confirmed (a verified GCash deposit or cash paid at the resort). The voucher is valid until the end of your check-in date.
                  </p>
                  <button type="button" className="review-button modal-done" disabled={!heldBooking} onClick={() => heldBooking && setReceiptBooking(heldBooking)}>
                    {heldBooking ? 'View & print walk-in voucher' : 'Preparing your voucher…'} <ArrowRight size={16} />
                  </button>
                  <button type="button" className="hold-secondary-button" onClick={closeReview}>Done</button>
                </div>
              )
            })() : paymentChoice === 'WALKIN' ? (<>
            <span className="modal-icon hold-icon"><Wallet size={22} /></span>
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> WALK-IN · CASH</span>
            <h2 id="review-title">Pay in cash<br /><em>at the resort.</em></h2>
            <p className="modal-copy">No online fee. Confirm to get a walk-in voucher with your reference number, then pay the full amount in cash at the resort.</p>
            <div className="review-details">
              <div><span>{selectedStays.length > 1 ? 'Accommodations' : 'Accommodation'}</span><b>{combinedStay.name}</b></div>
              <div><span>Tour type</span><b>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</b></div>
              <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
              <div><span>{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formattedDate(displayCheckoutDate(checkOutDate, tourType))} · {tourDetails[tourType].checkOut}</b></div>
              <div><span>Guests</span><b>{roomPax !== null && extraCount > 0 ? `${guestCount} (${mainCount} in the room + ${extraCount} extra)` : `${guestCount} (room for ${combinedStay.maxGuests})`}</b></div>
              <div><span>Online / GCash fee</span><b>{formatPeso(0)}</b></div>
              <div className="review-total"><span>Pay in cash at the resort</span><b>{formatPeso(totals.grandTotal)}</b></div>
            </div>
            <div className="inquiry-submit-form">
              <div className="signed-in-identity"><ShieldCheck size={17} /><span><b>{user?.name}</b><small>Signed in as {user?.email}</small></span></div>
              {storageError && <p className="customer-error" role="alert">{storageError}</p>}
              <button className="review-button modal-done" type="button" onClick={submitPendingHold} disabled={paymentSubmitting || holdSubmitting}>
                {holdSubmitting ? 'Creating your voucher…' : 'Confirm walk-in & get voucher'} <ArrowRight size={16} />
              </button>
              <p className="hold-disclaimer">
                First come, first served: a walk-in does not reserve the date. Your voucher is valid until the end of your check-in date; the dates are yours once the cash is paid at the resort, as long as no one else has confirmed them first. To lock the dates now, choose the online GCash reservation instead.
              </p>
              <button className="hold-secondary-button" type="button" onClick={() => setPaymentChoice('ONLINE')} disabled={holdSubmitting}>
                Switch to online GCash reservation
              </button>
            </div>
            </>) : (<>
            <span className="modal-icon"><ClipboardList size={22} /></span>
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> SECURE YOUR DATES</span>
            <h2 id="review-title">One step closer<br /><em>to your getaway.</em></h2>
            <p className="modal-copy">Review the resort rate and deposit breakdown, then continue to HitPay&apos;s secure GCash checkout. Your dates are confirmed only after the signed payment notification is verified.</p>
            <div className="review-details">
              <div><span>{selectedStays.length > 1 ? 'Accommodations' : 'Accommodation'}</span><b>{combinedStay.name}</b></div>
              <div><span>Tour type</span><b>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</b></div>
              <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
              <div><span>{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formattedDate(displayCheckoutDate(checkOutDate, tourType))} · {tourDetails[tourType].checkOut}</b></div>
              <div><span>Guests</span><b>{roomPax !== null && extraCount > 0 ? `${guestCount} (${mainCount} in the room + ${extraCount} extra)` : `${guestCount} (room for ${combinedStay.maxGuests})`}</b></div>
              <div><span>Base Resort Rate (net to resort)</span><b>{formatPeso(totals.grandTotal)}</b></div>
              <div><span>50% Reservation Deposit</span><b>{formatPeso(totals.depositRequired)}</b></div>
              <div><span>Online Gateway Fee (2.5%)</span><b>{formatPeso(gatewayFeeAmount)}</b></div>
              <div className="review-total"><span>Total GCash due now</span><b>{formatPeso(onlineCharge)}</b></div>
              <div><span>Cash balance due at check-in</span><b>{formatPeso(cashBalanceDue)}</b></div>
            </div>
            {combinedStay.exclusiveWholeResort ? (
              <div className="exclusive-resort-note inquiry-exclusive-note gold-glass-callout">
                <ShieldCheck size={16} />
                <span>
                  <b>Exclusive / Solo Use of Entire Resort &amp; Private Pool</b>
                  <small>Once your GCash reservation deposit is confirmed, no other guests or bookings can check in during your reserved dates.</small>
                </span>
              </div>
            ) : (
              <div className="shared-pool-note inquiry-exclusive-note shared-pool-callout">
                <Waves size={15} />
                <span>
                  <b>Standard Shared-Pool Access</b>
                  <small>Your booking includes standard shared access to the resort pool and grounds alongside other guests.</small>
                </span>
              </div>
            )}
            <form className="inquiry-submit-form" onSubmit={submitInquiry}>
              <div className="signed-in-identity"><ShieldCheck size={17} /><span><b>{user?.name}</b><small>Signed in as {user?.email}</small></span></div>
              {storageError && <p className="customer-error" role="alert">{storageError}</p>}
              <span className="priority-badge"><ShieldCheck size={12} /> TOP PRIORITY • INSTANT CONFIRMATION</span>
              <button className="review-button modal-done priority-button" type="submit" disabled={paymentSubmitting || holdSubmitting}>
                {paymentSubmitting ? 'Opening secure checkout…' : 'Continue to GCash checkout'} <ArrowRight size={16} />
              </button>
              <p className="form-footnote">HitPay securely handles the payment. Do not share your GCash PIN, password, or OTP.</p>
              <button className="hold-secondary-button" type="button" onClick={() => setPaymentChoice('WALKIN')} disabled={paymentSubmitting}>
                <Wallet size={15} /> Pay in cash at the resort instead (walk-in)
              </button>
            </form>
            </>)}
          </section>
        </div>
      )}
      {galleryStay && <StayGallery stay={galleryStay} onClose={() => setGalleryStayId(null)} />}
      {receiptBooking && <BookingReceiptModal booking={receiptBooking} onClose={() => setReceiptBooking(null)} />}
    </div>
  )
}

function App() {
  const route = window.location.pathname.replace(/\/+$/, '') || '/'
  const adminRoute = route === '/admin' || route === '/admin/dashboard'
  const customerRoute = route === '/customer/booking'
  // HitPay returns customers to /booking/return/<reference>?reference=<request id>&status=<status>.
  // The status is only used to choose a page; payment is confirmed by the server-side webhook.
  const hitpayReturnStatus = route.startsWith('/booking/return/')
    ? new URLSearchParams(window.location.search).get('status')?.toLowerCase() ?? ''
    : null
  const hitpayReturnCancelled = hitpayReturnStatus !== null && ['canceled', 'cancelled', 'failed', 'expired'].includes(hitpayReturnStatus)
  const bookingSuccessRoute = route === '/booking/success' || (hitpayReturnStatus !== null && !hitpayReturnCancelled)
  const bookingCancelledRoute = route === '/booking/cancelled' || hitpayReturnCancelled
  const previewRoute = route === '/preview'
  const loginRoute = route === '/login'
  const landingRoute = route === '/' || previewRoute

  useGlassSpotlight()

  return (
    <AuthProvider>
      {loginRoute ? <AuthPage /> : bookingSuccessRoute ? (
        <BookingSuccessPage />
      ) : bookingCancelledRoute ? (
        <BookingCancelledPage />
      ) : adminRoute ? (
        <ProtectedRoute role="ADMIN"><AdminRoute /></ProtectedRoute>
      ) : customerRoute ? (
        <ProtectedRoute role="CUSTOMER"><CustomerPage /></ProtectedRoute>
      ) : landingRoute ? (
        <CustomerPage />
      ) : <AuthPage />}
      {/* Geraint is available to guests and customers everywhere except the admin dashboard. */}
      {!adminRoute && <GeraintChatbot />}
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
