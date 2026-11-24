// Booking transparency for the admin Users tab. Dependency-free so both the Express server
// and the Cloudflare Worker (cloudflare/worker.ts) use the same rules.

export interface UserBookingRow {
  id: string
  user_id: string
  reference_number: string
  hold_reference_number: string | null
  accommodation_name: string
  tour_type: string
  check_in_date: string
  check_out_date: string
  base_resort_price: number | string
  paid_amount: number | string
  status: string
  payment_status: string
  payment_tier: string | null
  expires_at: Date | string | null
  created_at: Date | string
}

export interface UserRow {
  id: string
  full_name: string
  username: string
  email: string | null
  role: string
  created_at: Date | string
}

export type BookingOutcome = 'SUCCESSFUL' | 'FAILED' | 'PENDING_HOLD' | 'IN_PROGRESS'

const failedStatuses = new Set(['EXPIRED', 'CANCELLED', 'CANCELLED_BY_GCASH_PRIORITY'])

/**
 * Successful: CONFIRMED, or fully PAID. Failed / expired: EXPIRED, CANCELLED, or released by
 * another guest's confirmation, or a payment that wasn't received (NOT_PAID — this app's
 * "failed payment" state). Pending hold: an unexpired walk-in voucher. Everything else
 * (an inquiry awaiting payment, a payment under review, a paid booking whose dates were
 * taken) is in progress.
 */
export function bookingOutcome(booking: Pick<UserBookingRow, 'status' | 'payment_status' | 'expires_at'>, now = Date.now()): BookingOutcome {
  if (booking.status === 'CONFIRMED' || booking.payment_status === 'PAID') return 'SUCCESSFUL'
  if (failedStatuses.has(booking.status) || booking.payment_status === 'NOT_PAID') return 'FAILED'
  if (booking.status === 'PENDING_HOLD') {
    const expiresAt = booking.expires_at ? new Date(booking.expires_at).getTime() : 0
    return expiresAt > now ? 'PENDING_HOLD' : 'FAILED'
  }
  return 'IN_PROGRESS'
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

export function buildAdminUsers(users: UserRow[], bookings: UserBookingRow[], now = Date.now()) {
  const byUser = new Map<string, UserBookingRow[]>()
  for (const booking of bookings) {
    const list = byUser.get(booking.user_id) ?? []
    list.push(booking)
    byUser.set(booking.user_id, list)
  }
  return users.map((user) => {
    const history = (byUser.get(user.id) ?? []).map((booking) => ({
      id: booking.id,
      referenceNumber: booking.reference_number,
      holdReferenceNumber: booking.hold_reference_number,
      accommodationName: booking.accommodation_name,
      tourType: booking.tour_type,
      checkInDate: booking.check_in_date,
      checkOutDate: booking.check_out_date,
      amount: Number(booking.base_resort_price),
      paidAmount: Number(booking.paid_amount),
      status: booking.status,
      paymentStatus: booking.payment_status,
      paymentTier: booking.payment_tier,
      outcome: bookingOutcome(booking, now),
      createdAt: iso(booking.created_at),
    }))
    return {
      id: user.id,
      fullName: user.full_name,
      username: user.username,
      email: user.email ?? '',
      role: user.role,
      createdAt: iso(user.created_at),
      successfulBookings: history.filter((item) => item.outcome === 'SUCCESSFUL').length,
      failedOrExpiredBookings: history.filter((item) => item.outcome === 'FAILED').length,
      pendingHolds: history.filter((item) => item.outcome === 'PENDING_HOLD').length,
      bookingsHistory: history,
    }
  })
}

export function validDateInput(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function manilaToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
}
