import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Response } from 'express'
import type { AuthenticatedRequest } from './auth.js'
import {
  createBlockedDate,
  deleteBlockedDate,
  deleteUserAccount,
  listBlockedDates,
  listUsersWithBookings,
  rescheduleBooking,
} from './db.js'
import { accommodationNames, isKnownAccommodation, normalizeAccommodationIds } from './pricing.js'
import { buildAdminUsers, manilaToday, validDateInput } from './userStats.js'

const proofDirectory = process.env.PAYMENT_PROOF_DIR
  ? path.resolve(process.env.PAYMENT_PROOF_DIR)
  : fileURLToPath(new URL('../storage/payment-proofs/', import.meta.url))

/** GET /api/admin/users — every account with successful / failed booking counts and history. */
export async function adminUsers(_request: AuthenticatedRequest, response: Response) {
  const { users, bookings } = await listUsersWithBookings()
  response.json(buildAdminUsers(users, bookings))
}

/** DELETE /api/admin/users/:id[?purgeBookings=true] */
export async function removeAdminUser(request: AuthenticatedRequest, response: Response) {
  const requesterId = request.authUser?.id
  const userId = request.params.id
  if (!requesterId || typeof userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(userId)) {
    response.status(400).json({ message: 'A valid user ID is required.' })
    return
  }
  const purgeBookings = request.query.purgeBookings === 'true'
  const result = await deleteUserAccount({ userId, requesterId, purgeBookings })
  if (!result.ok) {
    const refusals = {
      NOT_FOUND: [404, 'User not found.'],
      SELF: [400, 'You cannot remove your own admin account.'],
      LAST_ADMIN: [409, 'This is the last admin account. Create another admin before removing it.'],
      ADMIN_PURGE: [400, 'Admin accounts can only be removed with their records kept, because walk-in cash bookings are recorded under the admin who logged them.'],
    } as const
    const [status, message] = refusals[result.reason]
    response.status(status).json({ message, reason: result.reason })
    return
  }
  // Payment screenshots of purged bookings: remove the private files too (best effort).
  await Promise.all(result.proofStorageKeys.map((key) =>
    unlink(path.join(proofDirectory, path.basename(key))).catch(() => undefined)))
  response.json({
    message: purgeBookings
      ? `User removed with ${result.purgedBookings} booking${result.purgedBookings === 1 ? '' : 's'} purged.`
      : `User removed. ${result.keptBookings} booking${result.keptBookings === 1 ? '' : 's'} and payment records were kept.`,
    purgedBookings: result.purgedBookings,
    keptBookings: result.keptBookings,
  })
}

function publicBlock(block: { id: string, accommodation_ids: string[], start_date: string, end_date: string, reason: string, created_at: Date | string }) {
  return {
    id: block.id,
    accommodationIds: block.accommodation_ids,
    accommodationName: block.accommodation_ids.length ? accommodationNames(block.accommodation_ids) : 'Whole resort',
    startDate: block.start_date,
    endDate: block.end_date,
    reason: block.reason,
    createdAt: new Date(block.created_at).toISOString(),
  }
}

/** GET /api/admin/blocked-dates */
export async function adminBlockedDates(_request: AuthenticatedRequest, response: Response) {
  response.json((await listBlockedDates()).map(publicBlock))
}

/**
 * Validates a block request. `accommodationIds` empty or missing closes the whole resort.
 * `endDate` is exclusive (the first open day), like a booking's check-out date.
 */
export function parseBlockRequest(body: unknown) {
  if (typeof body !== 'object' || body === null) return null
  const record = body as Record<string, unknown>
  const rawIds = record.accommodationIds ?? []
  if (!Array.isArray(rawIds) || !rawIds.every((id) => typeof id === 'string' && isKnownAccommodation(id))) return null
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''
  if (!validDateInput(record.startDate) || !validDateInput(record.endDate) ||
      record.endDate <= record.startDate || reason.length > 200) return null
  const days = (Date.parse(`${record.endDate}T00:00:00Z`) - Date.parse(`${record.startDate}T00:00:00Z`)) / 86_400_000
  if (days > 366) return null
  return {
    accommodationIds: normalizeAccommodationIds(rawIds as string[]),
    startDate: record.startDate,
    endDate: record.endDate,
    reason,
  }
}

/** POST /api/admin/blocked-dates */
export async function addBlockedDate(request: AuthenticatedRequest, response: Response) {
  const block = parseBlockRequest(request.body)
  if (!block || !request.authUser?.id) {
    response.status(400).json({ message: 'Choose valid dates (the end must be after the start, up to one year), valid accommodations, and a reason of 200 characters or fewer.' })
    return
  }
  if (block.endDate <= manilaToday()) {
    response.status(400).json({ message: 'Blocked dates must include today or a future date.' })
    return
  }
  const id = `BLK-${randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`
  const conflicts = await createBlockedDate({ id, ...block, createdBy: request.authUser.id })
  response.status(201).json({ id, conflictingReferences: conflicts })
}

/** DELETE /api/admin/blocked-dates/:id */
export async function removeBlockedDate(request: AuthenticatedRequest, response: Response) {
  const id = request.params.id
  if (typeof id !== 'string' || !(await deleteBlockedDate(id))) {
    response.status(404).json({ message: 'Blocked dates not found.' })
    return
  }
  response.status(204).end()
}

/** PATCH /api/admin/bookings/:id/reschedule — body { checkInDate } */
export async function rescheduleAdminBooking(request: AuthenticatedRequest, response: Response) {
  const bookingId = request.params.id
  const checkInDate = (request.body as { checkInDate?: unknown } | undefined)?.checkInDate
  if (typeof bookingId !== 'string' || !validDateInput(checkInDate)) {
    response.status(400).json({ message: 'Choose a valid new check-in date.' })
    return
  }
  if (checkInDate < manilaToday()) {
    response.status(400).json({ message: 'The new check-in date must be today or later.' })
    return
  }
  const result = await rescheduleBooking(bookingId, checkInDate)
  if (!result.ok) {
    const refusals = {
      NOT_FOUND: [404, 'Booking not found.'],
      NOT_CONFIRMED: [409, 'Only confirmed bookings can be rescheduled.'],
      UNCHANGED: [400, 'The booking already starts on that date.'],
      DATE_TAKEN: [409, 'Those dates conflict with another confirmed booking or blocked dates. Choose another date.'],
    } as const
    const [status, message] = refusals[result.reason]
    response.status(status).json({ message, reason: result.reason })
    return
  }
  response.json({ message: 'Booking rescheduled. Its reference number and payments are unchanged.', ...result })
}
