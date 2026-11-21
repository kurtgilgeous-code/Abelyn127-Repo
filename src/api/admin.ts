import { errorMessage } from './bookings'

export type BookingOutcome = 'SUCCESSFUL' | 'FAILED' | 'PENDING_HOLD' | 'IN_PROGRESS'

export interface UserBookingSummary {
  id: string
  referenceNumber: string
  holdReferenceNumber: string | null
  accommodationName: string
  tourType: string
  checkInDate: string
  checkOutDate: string
  amount: number
  paidAmount: number
  status: string
  paymentStatus: string
  paymentTier: string | null
  outcome: BookingOutcome
  createdAt: string
}

export interface AdminUser {
  id: string
  fullName: string
  username: string
  email: string
  role: 'ADMIN' | 'CUSTOMER'
  createdAt: string
  successfulBookings: number
  failedOrExpiredBookings: number
  pendingHolds: number
  bookingsHistory: UserBookingSummary[]
}

export interface BlockedDate {
  id: string
  /** Empty = the whole resort is closed. */
  accommodationIds: string[]
  accommodationName: string
  startDate: string
  /** Exclusive: the first day the dates are open again. */
  endDate: string
  reason: string
  createdAt: string
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) throw new Error(await errorMessage(response))
  return await response.json() as T
}

export async function fetchAdminUsers(token: string) {
  const users = await readJson<unknown>(await fetch('/api/admin/users', { headers: auth(token) }))
  if (!Array.isArray(users)) throw new Error('The server returned an invalid users response.')
  return users as AdminUser[]
}

export async function removeAdminUser(token: string, userId: string, purgeBookings: boolean) {
  const query = purgeBookings ? '?purgeBookings=true' : ''
  return readJson<{ message: string, purgedBookings: number, keptBookings: number }>(
    await fetch(`/api/admin/users/${encodeURIComponent(userId)}${query}`, { method: 'DELETE', headers: auth(token) }),
  )
}

export async function fetchBlockedDates(token: string) {
  const blocks = await readJson<unknown>(await fetch('/api/admin/blocked-dates', { headers: auth(token) }))
  if (!Array.isArray(blocks)) throw new Error('The server returned an invalid blocked-dates response.')
  return blocks as BlockedDate[]
}

export async function createBlockedDate(
  token: string,
  block: { accommodationIds: string[], startDate: string, endDate: string, reason: string },
) {
  return readJson<{ id: string, conflictingReferences: string[] }>(await fetch('/api/admin/blocked-dates', {
    method: 'POST',
    headers: { ...auth(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(block),
  }))
}

export async function deleteBlockedDate(token: string, id: string) {
  const response = await fetch(`/api/admin/blocked-dates/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(token) })
  if (!response.ok) throw new Error(await errorMessage(response))
}

export async function rescheduleBooking(token: string, bookingId: string, checkInDate: string) {
  return readJson<{ message: string, checkInDate: string, checkOutDate: string }>(
    await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/reschedule`, {
      method: 'PATCH',
      headers: { ...auth(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkInDate }),
    }),
  )
}
