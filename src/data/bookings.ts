export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DATE_UNAVAILABLE'
export type PaymentStatus = 'UNPAID' | 'PENDING_REVIEW' | 'PARTIALLY_PAID' | 'PAID' | 'NOT_PAID' | 'VOID'
export type PaymentMethod = 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER' | 'CASH'
export type TourType = 'OVERNIGHT' | 'DAY_TOUR' | 'NIGHT_TOUR'
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
  createdAt: string
  customerName: string
  customerContact: string
  accommodationId: string
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
}

export function formatBookingDate(date: string) {
  if (!date) return 'Date not selected'
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
