import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  Check,
  CircleDollarSign,
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
  createGcashBooking,
  createPendingHold,
  fetchAvailability,
  fetchCustomerBookings,
  submitPaymentProof,
} from './api/bookings'
import HoldCountdown from './components/HoldCountdown'
import { BOOKING_MAX_GUESTS, calculateBookingTotal, combineAccommodations, entranceRates, formatPeso, priceAccommodations, usesOvernightRates } from './utils/pricing'
import ResortLogo from './components/ResortLogo'
import CustomerSideNav from './components/CustomerSideNav'
import ProceedBookingBar from './components/ProceedBookingBar'
import BookingPolicyNote from './components/BookingPolicyNote'
import StayCarousel from './components/StayCarousel'
import GcashPaymentForm, { type GcashProof } from './components/GcashPaymentForm'
import { sectionLandings, sideNavSections } from './components/sideNavSections'
import AdminPage from './AdminPage'
import AuthPage from './AuthPage'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/useAuth'
import { useTheme } from './theme/ThemeProvider'
import ProtectedRoute from './ProtectedRoute'
import BookingReceiptModal from './BookingReceiptModal'
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
import './theme/button-pop.css'
import './theme/mobile.css'
import './theme/listing-cards.css'

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
  paymentChoice: PaymentChoice | null
}


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
    paymentChoice: 'paymentChoice' in value && (value.paymentChoice === 'GCASH_DEPOSIT' || value.paymentChoice === 'GCASH_FULL' || value.paymentChoice === 'WALKIN') ? value.paymentChoice : null,
  }
}

const guestTypeNames: Record<GuestType, [string, string]> = {
  adults: ['adult', 'adults'],
  seniorsPwd: ['senior/PWD', 'seniors/PWD'],
  children: ['child', 'children'],
}

/** "10 adults, 1 senior/PWD, 2 children" */
const describeGuests = (group: Record<GuestType, number>) => (Object.keys(guestTypeNames) as GuestType[])
  .filter((type) => group[type] > 0)
  .map((type) => `${group[type]} ${guestTypeNames[type][group[type] === 1 ? 0 : 1]}`)
  .join(', ')

/** How the guest pays. Nothing is chosen for them. */
type PaymentChoice = 'GCASH_DEPOSIT' | 'GCASH_FULL' | 'WALKIN'

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
  const [bookings, setBookings] = useState<Booking[]>([])
  const [storageError, setStorageError] = useState('')
  const [logoutError, setLogoutError] = useState('')
  const [lookupReference, setLookupReference] = useState('')
  const [lookupBookingId, setLookupBookingId] = useState('')
  const [paymentNotification, setPaymentNotification] = useState<{ message: string; rejected: boolean; bookingId: string } | null>(null)
  const [receiptBooking, setReceiptBooking] = useState<Booking | null>(null)
  const [galleryStayId, setGalleryStayId] = useState<string | null>(null)
  const { active: activeSection, scrollTo: scrollToSection } = useScrollSpy(sideNavSectionIds, sectionLandings)
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
  const [paymentChoice, setPaymentChoice] = useState<PaymentChoice | null>(guestBookingDraft?.paymentChoice ?? null)
  const [gcashSubmitting, setGcashSubmitting] = useState(false)
  const [gcashError, setGcashError] = useState('')
  const [gcashSent, setGcashSent] = useState<{ referenceNumber: string; amount: number; datesTaken: boolean } | null>(null)
  const [retryPayment, setRetryPayment] = useState<{ bookingId: string; name: string; amount: number; isBalance: boolean } | null>(null)
  const [openingPayment, setOpeningPayment] = useState(false)
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
  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  // Guests may go over the rooms' pax (extra heads pay entrance), up to one booking's cap.
  const guestLimit = BOOKING_MAX_GUESTS
  const overGuestLimit = guestCount > guestLimit
  const cashBalanceDue = Math.round((totals.grandTotal - totals.depositRequired) * 100) / 100
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

  // Arriving from another page with a #section link (sign-in, receipts): land on that section.
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (!sideNavSectionIds.includes(id)) return
    const land = () => scrollToSection(id, 'instant')
    const frame = window.requestAnimationFrame(land)
    const settled = window.setTimeout(land, 350)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settled)
    }
  }, [scrollToSection])

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

  useEffect(() => {
    if (!retryPayment) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setRetryPayment(null) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [retryPayment])

  function closeReview() {
    setShowReview(false)
    setHoldConfirmation(null)
    setGcashSent(null)
    setGcashError('')
  }

  const changeGuestCount = (type: GuestType, delta: number, group: 'main' | 'extra' = 'main') => {
    // Removing someone from a full room lets the next extra guest take the included spot.
    setParty((current) => rebalanceParty({
      ...current,
      [group]: { ...current[group], [type]: Math.max(0, current[group][type] + delta) },
    }, roomPax))
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

  const signInToBook = async () => {
    if (user) {
      if (paymentChoice === 'GCASH_DEPOSIT' || paymentChoice === 'GCASH_FULL') {
        // Check again right before the guest sends money, in case the page has been open a while.
        if (checkInDate < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })) {
          setStorageError('Choose a check-in date from today onward.')
          return
        }
        setOpeningPayment(true)
        try {
          const latest = await fetchAvailability(selectedIds, checkInDate, checkOutDate)
          if (!latest.available) {
            setAvailabilityResult({ key: availabilityKey, available: false, pendingHold: latest.pendingHold, blocked: latest.blocked })
            setStorageError('These dates were just taken. Please choose another date before paying.')
            return
          }
        } catch {
          setStorageError('Could not check these dates. Please check your connection and try again.')
          return
        } finally {
          setOpeningPayment(false)
        }
      }
      setStorageError('')
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

  const submitGcash = async (payment: GcashProof) => {
    if (!token || paymentChoice === null || paymentChoice === 'WALKIN') return
    const amount = paymentChoice === 'GCASH_FULL' ? totals.grandTotal : totals.depositRequired
    setGcashSubmitting(true)
    setGcashError('')
    try {
      const created = await createGcashBooking(token, {
        accommodationIds: selectedIds,
        tourType,
        checkInDate,
        checkOutDate,
        guests: { ...guests },
        ...(roomPax === null ? {} : { extraGuests: { ...extraGuests } }),
        estimatedTotal: totals.grandTotal,
        depositRequired: totals.depositRequired,
      }, { amount, ...payment })
      setGcashSent({ referenceNumber: created.referenceNumber, amount, datesTaken: created.datesTaken })
      setPaymentChoice(null)
      resetAvailabilityCheck()
      fetchCustomerBookings(token)
        .then(setBookings)
        .catch((error: unknown) => console.error('Could not refresh bookings after a GCash payment:', error))
    } catch (error) {
      setGcashError(error instanceof Error ? error.message : 'Could not send your payment.')
    } finally {
      setGcashSubmitting(false)
    }
  }

  const resendGcash = async (payment: GcashProof) => {
    if (!token || !retryPayment) return
    setGcashSubmitting(true)
    setGcashError('')
    try {
      const sent = await submitPaymentProof(token, retryPayment.bookingId, {
        paymentMethod: 'GCASH',
        paymentReference: payment.reference,
        payerAccount: payment.payerAccount,
        paymentAmount: retryPayment.amount,
        proof: payment.proof,
      })
      setPaymentNotification({
        message: sent.datesTaken
          ? 'Payment sent. These dates were taken by another verified booking, so the resort will help you adjust to another available date.'
          : 'Payment sent. The resort will verify it soon.',
        rejected: sent.datesTaken,
        bookingId: retryPayment.bookingId,
      })
      setRetryPayment(null)
      setBookings(await fetchCustomerBookings(token))
    } catch (error) {
      setGcashError(error instanceof Error ? error.message : 'Could not send your payment.')
    } finally {
      setGcashSubmitting(false)
    }
  }

  const openRetryPayment = async (booking: Booking, amount: number) => {
    setGcashError('')
    try {
      const latest = await fetchAvailability(booking.accommodationIds, booking.checkInDate, booking.checkOutDate)
      if (!latest.available) {
        setPaymentNotification({ message: 'These dates are no longer available. Please do not send a payment. Book another date, or message the resort if you already paid.', rejected: true, bookingId: booking.id })
        return
      }
    } catch {
      setPaymentNotification({ message: 'Could not check these dates. Please check your connection and try again.', rejected: true, bookingId: booking.id })
      return
    }
    setRetryPayment({ bookingId: booking.id, name: booking.accommodationName, amount, isBalance: false })
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

  // Who is coming, with each type of extra guest and what their entrance costs.
  const guestReviewRows = roomPax === null ? (
    <div><span>Guests</span><b>{guestCount} · {describeGuests(guests)}</b></div>
  ) : (
    <>
      <div><span>Total guests</span><b>{guestCount}</b></div>
      <div><span>In the room · entrance included</span><b>{mainCount} · {describeGuests(mainGuests)}</b></div>
      {(Object.keys(guestTypeNames) as GuestType[]).filter((type) => extraGuests[type] > 0).map((type) => (
        <div key={type}>
          <span>Extra {guestTypeNames[type][extraGuests[type] === 1 ? 0 : 1]} · {extraGuests[type]} × {formatPeso(extraEntrance[type])}{stayDays > 1 ? ` × ${stayDays} days` : ''}</span>
          <b>{formatPeso(extraGuests[type] * extraEntrance[type] * stayDays)}</b>
        </div>
      ))}
    </>
  )

  return (
    <div
      className="site-shell"
      onClick={(event) => {
        // Every in-page link uses the same accurate landing spot.
        if (event.defaultPrevented || !(event.target instanceof Element)) return
        const id = event.target.closest('a[href^="#"]')?.getAttribute('href')?.slice(1)
        if (!id || !sideNavSectionIds.includes(id)) return
        event.preventDefault()
        scrollToSection(id)
      }}
    >
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
              <a className="button button-light" href="#stays">
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
          <HeroShowcase />
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
                <article className={`listing-card ${stay.exclusiveWholeResort ? 'is-exclusive' : 'is-shared'} ${isSelected ? 'is-selected' : ''}`} key={stay.id} data-aos="fade-up" data-aos-delay={(index % 3) * 100}>
                  <div className={`listing-media listing-media-${(index % 4) + 1}`}>
                    {stay.photos[0]
                      ? <img src={stay.photos[0].src} alt="" loading="lazy" decoding="async" />
                      : <span className="listing-media-icon" aria-hidden="true">{index === 3 || index === 7 ? <TentTree size={34} /> : index === 2 || index === 5 ? <Compass size={34} /> : <House size={34} />}</span>}
                    <Tooltip label={stay.accessDescription}>
                      <span className={`listing-badge ${stay.exclusiveWholeResort ? 'badge-exclusive' : 'badge-shared'}`} tabIndex={0}>
                        {stay.exclusiveWholeResort ? 'Exclusive' : 'Shared Pool'}
                      </span>
                    </Tooltip>
                    <button
                      type="button"
                      className="listing-photos"
                      aria-label={`View inside and outside photos of ${stay.name}`}
                      onClick={() => setGalleryStayId(stay.id)}
                    >
                      <Images size={17} />
                      {stay.photos.length > 0 && <span className="listing-photos-count">{stay.photos.length}</span>}
                    </button>
                  </div>
                  <div className="listing-body">
                    <h3>{stay.name}</h3>
                    <p className="listing-meta">
                      {stay.exclusiveWholeResort ? <Sparkles size={14} aria-hidden="true" /> : <Waves size={14} aria-hidden="true" />}
                      {stay.category}
                    </p>
                    <ul className="listing-stats">
                      <li>Up to {stay.capacity} guests{stay.overnightCapacity ? ` (${stay.overnightCapacity} overnight)` : ''}</li>
                      <li>Day / Night tour {formatPeso(stay.baseRate)}</li>
                      {stay.features.filter((feature) => !/guests|entrance fee/i.test(feature)).slice(0, 3).map((feature) => <li key={feature}>{feature}</li>)}
                      {stay.entranceFeeForAll && <li className="listing-stat-note">Entrance fee for every guest</li>}
                    </ul>
                    <div className="listing-foot">
                      <p className="listing-price"><strong>{formatPeso(stay.overnightRate)}</strong><small>/ overnight</small></p>
                      <button
                        className={`listing-cta ${isSelected ? 'selected' : ''}`}
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={isSelected ? `Remove ${stay.name} from booking` : `Add ${stay.name} to booking`}
                        onClick={() => { toggleStay(stay.id); setProceedBarArmed(true) }}
                      >
                        {isSelected ? <><Check size={14} /> Added</> : <><Plus size={14} /> Add</>}
                      </button>
                    </div>
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

            <div className="booking-card" id="booking-form" data-aos="fade-up" data-aos-delay="150">
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
                      <small>{type === 'DAY_TOUR' ? '7 AM – 5 PM' : type === 'NIGHT_TOUR' ? '7 PM – 6 AM' : '2 PM – 12 NN'}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="form-field stay-picker">
                <legend>Accommodations <span>Select one or more</span></legend>
                <StayCarousel
                  stays={pricedStays}
                  selectedIds={selectedIds}
                  onToggle={toggleStay}
                  priceSuffix={overnightPricing ? '/22 hrs' : tourType === 'NIGHT_TOUR' ? '/night tour' : '/day tour'}
                />
                <small className="field-hint">
                  {selectedStays.length === 0
                    ? <b>Select at least one accommodation to continue.</b>
                    : <>{selectedStays.length} selected · <b>room for {combinedStay.maxGuests} pax</b>
                      {selectedStays.length > 1 && ` (${selectedStays.map((stay) => stay.capacity).join(' + ')})`}</>}
                </small>
                <small className="field-hint tour-rate-hint">
                  {overnightPricing
                    ? <>Overnight rate{tourType === 'OVERNIGHT' ? ' (22 hours)' : `, charged for each of the ${stayDays} days`}. Entrance is included up to the room&apos;s pax.</>
                    : <>{tourDetails[tourType].label} rate. Entrance is included up to the room&apos;s pax.</>}
                </small>
                {selectedStays.length === 0 ? null : combinedStay.exclusiveWholeResort ? (
                  <div className="exclusive-resort-note booking-exclusive-note gold-glass-callout">
                    <ShieldCheck size={16} />
                    <span>
                      <b>Exclusive Private Stay</b>
                      <small>
                        {selectedStays.length > 1
                          ? 'Once confirmed, the resort and pool are private for your group and no other guests can book or check in during your dates. Only the rooms you selected are included.'
                          : 'Once confirmed, the resort and pool are private for your group and no other guests can book or check in during your dates. Only the room you selected is included.'}
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
              <p className={`availability-status availability-${availabilityStatus}`} role="status" aria-live="polite" hidden={selectedStays.length === 0 && availabilityStatus === 'idle'}>
                {availabilityStatus === 'checking'
                  ? 'Checking these dates…'
                  : availabilityStatus === 'available'
                    ? datesHaveSoftHold
                      ? 'Still open: another guest has a walk-in voucher for these dates, but vouchers don\'t reserve them. The first booking confirmed gets the dates.'
                      : combinedStay.exclusiveWholeResort
                        ? 'Dates look available. The resort and pool will be private for your group once this booking is confirmed.'
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
              <ul className="booking-rules">
                <li><b>First come, first served.</b> The first verified payment gets the date.</li>
                <li><b>No refunds.</b> You can ask to change your date, subject to approval.</li>
              </ul>
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
                    return (
                      <div className="guest-row" key={type}>
                        <span><b>{guestLabels[type].title}</b><small>{guestLabels[type].detail}</small></span>
                        <div className="guest-stepper">
                          <button type="button" aria-label={`Remove one ${guestLabels[type].title.toLowerCase()} from the room`} disabled={mainGuests[type] === 0 || (type === 'adults' && mainGuests.adults === 1)} onClick={() => changeGuestCount(type, -1)}><Minus size={14} /></button>
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
                <div className="estimate-line estimate-base"><span>Resort rate</span><b>{formatPeso(totals.grandTotal)}</b></div>
                <p className="estimate-choose">Choose how you&apos;d like to pay:</p>
                <div className="estimate-options" role="radiogroup" aria-label="How would you like to pay?">
                  {([
                    { id: 'GCASH_DEPOSIT', tone: 'is-online', title: 'GCash · 50% downpayment', note: 'The first verified payment gets the date.', due: 'Pay now via GCash', amount: totals.depositRequired, rest: `Remaining ${formatPeso(cashBalanceDue)} at check-in` },
                    { id: 'GCASH_FULL', tone: 'is-online', title: 'GCash · Full payment', note: 'The first verified payment gets the date.', due: 'Pay now via GCash', amount: totals.grandTotal, rest: 'Nothing left to pay at check-in' },
                    { id: 'WALKIN', tone: 'is-walkin', title: 'Walk-In · Cash', note: 'No reservation; same-day availability is checked on arrival.', due: 'Pay in cash on arrival', amount: totals.grandTotal, rest: '' },
                  ] as const).map((option) => (
                    <div
                      key={option.id}
                      className={`estimate-option ${option.tone}${paymentChoice === option.id ? ' is-selected' : ''}`}
                      role="radio"
                      aria-checked={paymentChoice === option.id}
                      aria-label={option.title}
                      tabIndex={0}
                      onClick={() => setPaymentChoice(option.id)}
                      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPaymentChoice(option.id) } }}
                    >
                      <header><span className="estimate-option-radio" aria-hidden="true">{paymentChoice === option.id && <Check size={12} strokeWidth={3} />}</span><b>{option.title}</b><small>{option.note}</small></header>
                      <div className="estimate-total"><span>{option.due}</span><b>{formatPeso(option.amount)}</b></div>
                      {option.rest && <div className="deposit-row"><span>{option.rest}</span></div>}
                    </div>
                  ))}
                </div>
                <p className="estimate-disclaimer">
                  {combinedStay.entranceFeeForAll
                    ? `Entrance fees apply to every guest for each of the ${stayDays} ${stayDays === 1 ? 'day' : 'days'}.`
                    : `Entrance fees apply per day to guests above the ${combinedStay.capacity}-guest ${selectedStays.length > 1 ? 'combined capacity' : 'capacity'}.`}
                </p>
                </>)}
              </div>
              {storageError && <p className="customer-error" role="alert">{storageError}</p>}
              <button ref={reviewButtonRef} className="review-button" type="button" onClick={() => { void signInToBook() }} disabled={openingPayment || selectedStays.length === 0 || (Boolean(user) && !paymentChoice) || !checkInDate || !checkOutDate || checkOutDate <= checkInDate || guestCount === 0 || overGuestLimit || availabilityStatus === 'checking' || availabilityStatus === 'unavailable'}>
                {selectedStays.length === 0
                  ? 'Select an accommodation first'
                  : user
                    ? paymentChoice === null ? 'Choose how to pay' : paymentChoice === 'WALKIN' ? 'Review walk-in & get voucher' : 'Review & pay with GCash'
                    : 'Sign In to Book'} <ArrowRight size={17} />
              </button>
              <p className="form-footnote">
                After you sign in, pay by GCash and send your screenshot, or get a walk-in voucher. Your dates are confirmed only when the resort verifies your payment.
              </p>
            </div>
          </div>
        </section>

        <section className="customer-followup section-wrap" id="my-inquiry">
          <div className="customer-followup-copy" data-aos="fade-right">
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> CUSTOMER INQUIRY</span>
            <h2>Already sent an<br /><em>inquiry?</em></h2>
            <p>Check whether the resort has verified your payment. If you paid a downpayment, pay the balance here by GCash or at the resort on check-in.</p>
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
                            The resort did not receive your {formatPeso(lastRejectedPayment.amount)} payment. Please try again.
                          </span>
                        )}
                        <span className={booking.status === 'DATE_UNAVAILABLE' || booking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'customer-date-unavailable' : booking.status === 'PENDING_HOLD' ? 'customer-hold-status' : ''}>
                          {booking.status === 'PENDING_HOLD'
                            ? isActiveHold(booking, now)
                              ? `Walk-in voucher · valid for ${formatHoldTimeLeft(holdMillisecondsLeft(booking.expiresAt, now))} · pay cash at the resort`
                              : 'Pending hold expired · dates released'
                            : booking.status === 'EXPIRED'
                            ? booking.paymentTier === 'ONLINE_GCASH_RESERVATION'
                              ? 'GCash payment was not verified · booking expired. Book again to reserve a date.'
                              : 'Voucher expired after the check-in date · dates released'
                            : booking.status === 'CANCELLED_BY_GCASH_PRIORITY'
                            ? 'Hold released · another guest\'s booking was confirmed first'
                            : booking.status === 'DATE_UNAVAILABLE'
                            ? 'Payment received, but dates were secured by an earlier-verified booking. The resort will contact you about next steps.'
                            : booking.paymentStatus === 'PENDING_REVIEW'
                            ? 'GCash payment sent · waiting for the resort to verify it. Your dates are not secured yet.'
                            : booking.paymentStatus === 'PAID' || booking.paymentStatus === 'PAID_CASH'
                              ? 'Fully paid'
                              : booking.paymentTier === 'ONLINE_GCASH_RESERVATION' && booking.paidAmount > 0
                                ? `GCash payment verified · ${formatPeso(balance)} balance due at check-in`
                                : booking.status !== 'CANCELLED' && booking.paymentTier === 'ONLINE_GCASH_RESERVATION'
                                  ? `GCash payment not verified · ${formatPeso(booking.totalOnlinePaid)}`
                              : booking.status === 'CANCELLED'
                                ? 'Booking cancelled'
                                : booking.paidAmount > 0
                                  ? `Remaining balance: ${formatPeso(balance)}`
                                  : `Payment required: at least ${formatPeso(booking.depositRequired)}`}
                        </span>
                        {lastRejectedPayment && booking.status === 'PENDING' && booking.paymentTier === 'ONLINE_GCASH_RESERVATION' && booking.paymentStatus === 'NOT_PAID' && (
                          <button type="button" className="customer-booking-view-button" onClick={() => { void openRetryPayment(booking, lastRejectedPayment.amount) }}>
                            Send GCash payment again <ArrowRight size={14} />
                          </button>
                        )}
                        {booking.status === 'CONFIRMED' && booking.paymentTier === 'ONLINE_GCASH_RESERVATION' && booking.paidAmount > 0 && balance > 0 && booking.paymentStatus !== 'PENDING_REVIEW' && (
                          <button type="button" className="customer-booking-view-button" onClick={() => { setGcashError(''); setRetryPayment({ bookingId: booking.id, name: booking.accommodationName, amount: balance, isBalance: true }) }}>
                            Pay {formatPeso(balance)} balance by GCash <ArrowRight size={14} />
                          </button>
                        )}
                        {booking.status === 'DATE_UNAVAILABLE' && (
                          <small className="customer-date-unavailable">
                            To adjust your booking to another available date, message the resort on{' '}
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
              <input id="lookup-reference" value={lookupReference} onChange={(event) => setLookupReference(event.target.value)} placeholder="e.g. TRP-HOLD-20261115-8492" required />
              <label htmlFor="lookup-contact">Phone or email used on the request</label>
              <input id="lookup-contact" value={user.email || user.username} placeholder="Your account" readOnly required />
              <button className="review-button" type="submit">Find inquiry <ArrowRight size={16} /></button>
              {lookupError && <p className="customer-error" role="alert">{lookupError}</p>}
            </form> : <div className="lookup-signin"><p>Sign in with the account used for your inquiry to check its status or report a payment.</p><a className="review-button" href="/login?next=my-bookings">Sign in <ArrowRight size={16} /></a></div>}
            {user && lookupBooking && (
              <div className="lookup-result">
                <div className="lookup-result-top">
                  <span><b>{lookupBooking.accommodationName}</b><small>{tourDetails[lookupBooking.tourType].label} · {formattedDate(lookupBooking.checkInDate)} – {formattedDate(displayCheckoutDate(lookupBooking.checkOutDate, lookupBooking.tourType))} · {lookupBooking.guestCount} guests</small></span>
                  <span className={`status-badge status-${lookupBooking.status.toLowerCase()}`}>{lookupBooking.status === 'PENDING' ? 'Under review' : lookupBooking.status === 'CONFIRMED' ? 'Confirmed' : lookupBooking.status === 'DATE_UNAVAILABLE' ? 'Dates unavailable' : lookupBooking.status === 'PENDING_HOLD' ? 'Walk-in voucher' : lookupBooking.status === 'EXPIRED' ? (lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? 'Not verified' : 'Voucher expired') : lookupBooking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'Hold released' : 'Declined'}</span>
                </div>
                <p className="lookup-payment-state"><CircleDollarSign size={15} /> {lookupBooking.status === 'PENDING_HOLD' ? (isActiveHold(lookupBooking, now) ? `Heads-up hold only (first-come, first-served). It expires in ${formatHoldTimeLeft(holdMillisecondsLeft(lookupBooking.expiresAt, now))}. Pay ${formatPeso(lookupBooking.baseResortPrice)} in cash at the resort before then.` : 'This pending hold has expired and the dates were released.') : lookupBooking.status === 'EXPIRED' ? (lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? 'This GCash payment was not verified before the check-in date. Book again to reserve a date.' : 'This voucher expired after the check-in date without payment, so the dates were released.') : lookupBooking.status === 'CANCELLED_BY_GCASH_PRIORITY' ? 'Another guest\'s booking for these dates was confirmed first (first come, first served), so this unpaid hold was released.' : lookupBooking.status === 'DATE_UNAVAILABLE' ? `Your payment of ${formatPeso(lookupBooking.paidAmount)} was received, but another confirmed booking secured these dates first. The resort will contact you to adjust your booking to another available date.` : lookupBooking.status === 'CANCELLED' ? 'This booking was cancelled by the resort.' : lookupBooking.paymentStatus === 'PAID_CASH' ? 'Walk-in cash payment received in full. Your booking is confirmed.' : lookupBooking.paymentStatus === 'PAID' ? 'Full payment verified. Your booking is successful.' : lookupBooking.paymentStatus === 'PENDING_REVIEW' ? 'Your GCash payment is waiting for the resort to verify it. Your dates are not secured until then.' : lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' && lookupBooking.paidAmount > 0 ? `GCash payment verified. The remaining ${formatPeso(Math.max(0, lookupBooking.baseResortPrice - lookupBooking.paidAmount))} is due at check-in.` : lookupBooking.paymentTier === 'ONLINE_GCASH_RESERVATION' ? 'Your GCash payment was not verified.' : lookupBooking.paymentStatus === 'NOT_PAID' ? 'The payment was not confirmed.' : 'Your booking is waiting for payment confirmation.'}</p>
                {lookupBooking.status === 'DATE_UNAVAILABLE' && (
                  <p className="customer-date-unavailable">
                    To adjust your booking to another available date, message the resort on{' '}
                    <a href="https://www.facebook.com/profile.php?id=61553358111597" target="_blank" rel="noreferrer">Facebook</a>.
                  </p>
                )}
                {(() => {
                  const rejectedPayment = [...lookupBooking.payments].reverse().find((payment) => payment.status === 'NOT_RECEIVED')
                  return rejectedPayment && lookupBooking.paymentStatus !== 'PENDING_REVIEW'
                    ? <div className="payment-rejected-warning" role="alert"><AlertTriangle size={17} /><span><b>Payment not received</b><small>The resort did not receive your {formatPeso(rejectedPayment.amount)} payment. Please check your transaction details and submit the payment again.</small></span></div>
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
                <button className="customer-booking-view-button" type="button" onClick={() => setReceiptBooking(lookupBooking)}>View receipt <ArrowRight size={14} /></button>
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
              <ul className="rates-summary">
                <li><Sun size={16} aria-hidden="true" /><span><b>Day Tour</b> 7:00 AM – 5:00 PM</span></li>
                <li><Moon size={16} aria-hidden="true" /><span><b>Night Tour</b> 7:00 PM – 6:00 AM</span></li>
                <li><Clock3 size={16} aria-hidden="true" /><span><b>Overnight</b> 22 hours, 2:00 PM – 12:00 NN</span></li>
                <li><Check size={16} aria-hidden="true" /><span>Day and Night Tours cost the same. Overnight has its own rate.</span></li>
                <li><Users size={16} aria-hidden="true" /><span>Entrance is free up to the room&apos;s pax. Extra guests pay the entrance fee.</span></li>
              </ul>
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
            <div className="rates-notes" data-aos="fade-up">
              <div className="rates-notes-group">
                <h3><CircleDollarSign size={18} aria-hidden="true" /> How your total is worked out</h3>
                <ul>
                  <li><b>One-day Day or Night Tour:</b> the tour rate.</li>
                  <li><b>Overnight, or 2 or more days:</b> the overnight rate for each day. Example: Abelyn&apos;s Cabin Glass for 3 days is 3 × ₱7,500 = ₱22,500.</li>
                  <li><b>Entrance:</b> included up to the room&apos;s pax. Each extra guest pays the entrance fee shown above.</li>
                  <li><b>Gazebo, Calesa Tables, and Kubo ni Gerrant:</b> every guest pays entrance.</li>
                  <li><b>Big groups:</b> welcome, up to 100 guests per booking.</li>
                </ul>
              </div>
              <div className="rates-notes-group">
                <h3><Wallet size={18} aria-hidden="true" /> Before you pay</h3>
                <ul>
                  <li>Confirm availability and the final charges with Tampisawan.</li>
                  <li>Payments are <b>non-refundable</b>.</li>
                  <li>You can ask to change your date. Changes depend on availability and the resort&apos;s approval.</li>
                </ul>
              </div>
            </div>
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
                    First come, first served: a walk-in voucher does not reserve the date. The dates stay open to other guests until a booking is confirmed (a verified GCash payment or cash paid at the resort). The voucher is valid until the end of your check-in date.
                  </p>
                  <button type="button" className="review-button modal-done" disabled={!heldBooking} onClick={() => heldBooking && setReceiptBooking(heldBooking)}>
                    {heldBooking ? 'View & print walk-in voucher' : 'Preparing your voucher…'} <ArrowRight size={16} />
                  </button>
                  <button type="button" className="hold-secondary-button" onClick={closeReview}>Done</button>
                </div>
              )
            })() : gcashSent ? (
              <div className="hold-confirmation">
                <span className="modal-icon hold-icon"><Hourglass size={22} /></span>
                <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> PAYMENT SENT</span>
                <h2 id="review-title">Waiting for<br /><em>verification.</em></h2>
                <p className="modal-copy">The resort will check your {formatPeso(gcashSent.amount)} GCash payment. {gcashSent.datesTaken ? 'Your payment is recorded.' : 'Your booking is confirmed once it is verified.'}</p>
                <div className="hold-reference"><span>Booking reference</span><b>{gcashSent.referenceNumber}</b></div>
                <p className="hold-disclaimer">{gcashSent.datesTaken ? 'Another guest was verified for these dates while you were paying. The resort will help you adjust to another available date.' : <>Your dates are not secured yet. If another guest&apos;s payment is verified first, the resort will help you adjust to another available date.</>}</p>
                <BookingPolicyNote />
                <button type="button" className="review-button modal-done" onClick={() => { closeReview(); scrollToSection('my-inquiry') }}>Check my booking <ArrowRight size={16} /></button>
              </div>
            ) : paymentChoice === 'GCASH_DEPOSIT' || paymentChoice === 'GCASH_FULL' ? (<>
            <span className="modal-icon"><Wallet size={22} /></span>
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> GCASH PAYMENT</span>
            <h2 id="review-title">Scan, pay,<br /><em>send your receipt.</em></h2>
            <div className="review-details">
              <div><span>{selectedStays.length > 1 ? 'Accommodations' : 'Accommodation'}</span><b>{combinedStay.name}</b></div>
              <div><span>Tour type</span><b>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</b></div>
              <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
              <div><span>{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formattedDate(displayCheckoutDate(checkOutDate, tourType))} · {tourDetails[tourType].checkOut}</b></div>
              {guestReviewRows}
              <div><span>Total</span><b>{formatPeso(totals.grandTotal)}</b></div>
              {paymentChoice === 'GCASH_DEPOSIT' && <div><span>Balance due at check-in</span><b>{formatPeso(cashBalanceDue)}</b></div>}
            </div>
            <BookingPolicyNote />
            <GcashPaymentForm
              amount={paymentChoice === 'GCASH_FULL' ? totals.grandTotal : totals.depositRequired}
              amountLabel={paymentChoice === 'GCASH_FULL' ? 'Full payment' : '50% downpayment'}
              submitting={gcashSubmitting}
              error={gcashError}
              onSubmit={submitGcash}
            />
            </>) : (<>
            <span className="modal-icon hold-icon"><Wallet size={22} /></span>
            <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> WALK-IN · CASH</span>
            <h2 id="review-title">Pay in cash<br /><em>at the resort.</em></h2>
            <p className="modal-copy">Confirm to get a walk-in voucher with your reference number, then pay the full amount in cash at the resort.</p>
            <div className="review-details">
              <div><span>{selectedStays.length > 1 ? 'Accommodations' : 'Accommodation'}</span><b>{combinedStay.name}</b></div>
              <div><span>Tour type</span><b>{tourDetails[tourType].label} · {tourDetails[tourType].duration}</b></div>
              <div><span>Check-in</span><b>{formattedDate(checkInDate)} · {tourDetails[tourType].checkIn}</b></div>
              <div><span>{tourType === 'DAY_TOUR' ? 'Last tour day' : 'Check-out'} · {stayDays} {stayDays === 1 ? 'day' : 'days'}</span><b>{formattedDate(displayCheckoutDate(checkOutDate, tourType))} · {tourDetails[tourType].checkOut}</b></div>
              {guestReviewRows}
              <div className="review-total"><span>Pay in cash at the resort</span><b>{formatPeso(totals.grandTotal)}</b></div>
            </div>
            <div className="inquiry-submit-form">
              <div className="signed-in-identity"><ShieldCheck size={17} /><span><b>{user?.name}</b><small>Signed in as {user?.email}</small></span></div>
              {storageError && <p className="customer-error" role="alert">{storageError}</p>}
              <BookingPolicyNote />
              <button className="review-button modal-done" type="button" onClick={submitPendingHold} disabled={holdSubmitting}>
                {holdSubmitting ? 'Creating your voucher…' : 'Confirm walk-in & get voucher'} <ArrowRight size={16} />
              </button>
              <p className="hold-disclaimer">
                First come, first served: a walk-in does not reserve the date. Your voucher is valid until the end of your check-in date; the dates are yours once the cash is paid at the resort, as long as no one else has confirmed them first. To get priority, pay by GCash instead.
              </p>
                          </div>
            </>)}
          </section>
        </div>
      )}
      {retryPayment && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRetryPayment(null) }}>
          <section className="review-modal inquiry-modal" role="dialog" aria-modal="true" aria-labelledby="retry-title">
            <button className="modal-close" type="button" aria-label="Close" onClick={() => setRetryPayment(null)}><X size={19} /></button>
            <span className="modal-icon"><Wallet size={22} /></span>
            <h2 id="retry-title">{retryPayment.isBalance ? <>Pay your<br /><em>balance.</em></> : <>Send your<br /><em>payment again.</em></>}</h2>
            <p className="modal-copy">{retryPayment.name}</p>
            <GcashPaymentForm amount={retryPayment.amount} amountLabel={retryPayment.isBalance ? 'Remaining balance' : 'GCash payment'} submitting={gcashSubmitting} error={gcashError} onSubmit={resendGcash} />
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
  const previewRoute = route === '/preview'
  const loginRoute = route === '/login'
  const landingRoute = route === '/' || previewRoute

  useGlassSpotlight()

  return (
    <AuthProvider>
      {loginRoute ? <AuthPage /> : adminRoute ? (
        <AdminRoute />
      ) : customerRoute ? (
        <ProtectedRoute role="CUSTOMER"><CustomerPage /></ProtectedRoute>
      ) : landingRoute ? (
        <CustomerPage />
      ) : <AuthPage />}
      {/* Geraint stays off the sign-in page and the admin dashboard. */}
      {(landingRoute || customerRoute) && <GeraintChatbot />}
    </AuthProvider>
  )
}

function AdminRoute() {
  const { user, token, loading, logout } = useAuth()
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (loading) return
    if (!user || user.role !== 'ADMIN') {
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
        if (!response.ok) throw new Error('This page could not be loaded.')
        if (active) setChecking(false)
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(cause instanceof Error ? cause.message : 'This page could not be loaded.')
          setChecking(false)
        }
      })

    return () => {
      active = false
    }
  }, [loading, user, token, logout])

  if (loading || checking) return <div className="auth-loading">Loading…</div>
  if (error) return <div className="auth-failure" role="alert">{error}<p>Please try again.</p></div>
  if (!user || user.role !== 'ADMIN') return <div className="auth-loading">Redirecting…</div>
  return <AdminPage />
}

export default App
