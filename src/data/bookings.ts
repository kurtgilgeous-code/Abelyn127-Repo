export type BookingStatus =
  | 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DATE_UNAVAILABLE'
  | 'PENDING_HOLD' | 'EXPIRED' | 'CANCELLED_BY_GCASH_PRIORITY'
export type PaymentStatus = 'UNPAID' | 'PENDING_REVIEW' | 'PARTIALLY_PAID' | 'PAID' | 'PAID_CASH' | 'NOT_PAID' | 'VOID'
export type PaymentMethod = 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER' | 'CASH'
export type TourType = 'OVERNIGHT' | 'DAY_TOUR' | 'NIGHT_TOUR'
export type PaymentTier = 'ONLINE_GCASH_RESERVATION' | 'WALKIN_CASH_NO_RESERVATION' | 'PENDING_CASH_INQUIRY'
export const tourDetails: Record<TourType, { label: string; checkIn: string; checkOut: string; duration: string }> = {
  OVERNIGHT: { label: 'Overnight', checkIn: '2:00 PM', checkOut: '12:00 NN', duration: '22 hours' },
  DAY_TOUR: { label: 'Day Tour', checkIn: '7:00 AM', checkOut: '5:00 PM', duration: '10 hours' },
  NIGHT_TOUR: { label: 'Night Tour', checkIn: '7:00 PM', checkOut: '6:00 AM', duration: '11 hours' },
}

export function displayCheckoutDate(checkOutDate: string, tourType: TourType) {
  if (!checkOutDate || tourType !== 'DAY_TOUR') return checkOutDate
  const [year, month, day] = checkOutDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

export interface BookingPayment {
  id: string
  amount: number
  method: PaymentMethod
  reference: string
  payerAccount: string
  source: 'CUSTOMER' | 'ADMIN_CASH'
  status: 'PENDING_REVIEW' | 'RECEIVED' | 'NOT_RECEIVED'
  submittedAt: string
  verifiedAt: string | null
  proofFileName: string | null
  hasProof: boolean
}

export interface Booking {
  id: string
  referenceNumber: string
  paymentTier: PaymentTier | null
  baseResortPrice: number
  baseDepositAmount: number
  gatewayFeeAmount: number
  totalOnlinePaid: number
  cashBalanceDue: number
  gatewayPaymentId: string | null
  createdAt: string
  customerName: string
  customerContact: string
  accommodationId: string
  /** Every accommodation in this booking (one booking can combine several). */
  accommodationIds: string[]
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  guests: {
    adults: number
    seniorsPwd: number
    children: number
  }
  guestCount: number
  /** Guests added beyond the rooms' pax, by type (they pay entrance); null on older bookings. */
  extraGuests: { adults: number; seniorsPwd: number; children: number } | null
  estimatedTotal: number
  depositRequired: number
  paymentAmount: number | null
  paidAmount: number
  payments: BookingPayment[]
  status: BookingStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod | null
  paymentReference: string
  proofFileName: string | null
  hasPaymentProof: boolean
  /** When a 24-hour pending cash hold expires (ISO timestamp); null for other bookings. */
  expiresAt: string | null
  /** 1 = GCash reservation / confirmed cash, 2 = 24-hour pending cash hold. */
  priorityRank: number | null
  /** Original TRP-HOLD reference of a hold the admin later confirmed with cash. */
  holdReferenceNumber: string | null
}

/** Milliseconds left on a pending hold (0 once expired). */
export function holdMillisecondsLeft(expiresAt: string | null, now: number) {
  if (!expiresAt) return 0
  return Math.max(0, Date.parse(expiresAt) - now)
}

/** "18h 42m" style countdown for a pending hold. */
export function formatHoldTimeLeft(milliseconds: number) {
  const totalMinutes = Math.ceil(milliseconds / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? hours + 'h ' + String(minutes).padStart(2, '0') + 'm' : minutes + 'm'
}

/** A hold that is still PENDING_HOLD and inside its 24-hour window. */
export function isActiveHold(booking: Pick<Booking, 'status' | 'expiresAt'>, now: number) {
  return booking.status === 'PENDING_HOLD' && holdMillisecondsLeft(booking.expiresAt, now) > 0
}

export function formatBookingDate(date: string) {
  if (!date) return 'Date not selected'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
