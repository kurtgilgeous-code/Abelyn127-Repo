import { randomInt, randomUUID } from 'node:crypto'
import type { Response } from 'express'
import type { AuthenticatedRequest } from './auth.js'
import {
  confirmPendingHoldWithCash,
  createPendingHold,
  createWalkInCashBooking,
  MAX_ACTIVE_HOLDS_PER_USER,
  type TourType,
} from './db.js'
import { calculateServerBookingTotal, guestLimitMessage, parseAccommodationIds, parseExtraGuests } from './pricing.js'

const tourTypes: TourType[] = ['OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function getBookingDetails(body: unknown) {
  if (!isRecord(body) || !isRecord(body.guests)) return null
  const adults = body.guests.adults
  const seniorsPwd = body.guests.seniorsPwd
  const children = body.guests.children
  const tourType = body.tourType
  const accommodationIds = parseAccommodationIds(body)
  const checkInDate = body.checkInDate
  const checkOutDate = body.checkOutDate
  if (
    !accommodationIds ||
    !tourTypes.includes(tourType as TourType) ||
    !validDate(checkInDate) || !validDate(checkOutDate) || checkOutDate <= checkInDate ||
    typeof adults !== 'number' || !Number.isInteger(adults) || adults < 0 ||
    typeof seniorsPwd !== 'number' || !Number.isInteger(seniorsPwd) || seniorsPwd < 0 ||
    typeof children !== 'number' || !Number.isInteger(children) || children < 0
  ) return null
  const guestCount = adults + seniorsPwd + children
  if (guestCount < 1) return null
  const extras = parseExtraGuests(body)
  if (extras === null) return null
  const days = (Date.parse(`${checkOutDate}T00:00:00.000Z`) - Date.parse(`${checkInDate}T00:00:00.000Z`)) / 86_400_000
  // The server derives the booking's display name from the accommodations; the client's
  // name (if any) is ignored rather than trusted.
  const pricing = calculateServerBookingTotal(
    accommodationIds,
    tourType as TourType,
    { adults, seniorsPwd, children },
    days,
    extras,
  )
  if (!pricing) return null
  return {
    accommodationIds: pricing.accommodationIds,
    accommodationName: pricing.accommodationName,
    tourType: tourType as TourType,
    checkInDate,
    checkOutDate,
    adults,
    seniorsPwd,
    children,
    guestCount,
    extraGuests: pricing.extraGuests,
    baseResortPrice: Math.round(pricing.total * 100) / 100,
    baseDepositAmount: Math.round(pricing.total * 50) / 100,
  }
}

function localDateStamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}${values.month}${values.day}`
}

function nextReference(prefix: 'GCASH' | 'CASH' | 'HOLD') {
  return `TRP-${prefix}-${localDateStamp()}-${randomInt(0, 10000).toString().padStart(4, '0')}`
}

function uniqueViolation(error: unknown) {
  return isRecord(error) && error.code === '23505'
}

export const holdRefusalMessages = {
  DATE_CONFIRMED: 'These dates were already secured by a confirmed booking. Please choose another date or accommodation.',
  DATE_BLOCKED: 'The resort has closed these dates (maintenance or private use). Please choose another date or accommodation.',
  ALREADY_HELD: 'You already have an active walk-in voucher for these dates. Pay in cash at the resort.',
  HOLD_LIMIT: `You can have up to ${MAX_ACTIVE_HOLDS_PER_USER} active walk-in vouchers at a time. Wait for one to expire.`,
} as const

/** POST /api/bookings/pending-hold — Priority #2 "reserve now, pay cash later" walk-in voucher. */
export async function createPendingHoldBooking(request: AuthenticatedRequest, response: Response) {
  const user = request.authUser
  if (!user?.id) {
    response.status(401).json({ message: 'Please sign in before holding a date.' })
    return
  }
  const booking = getBookingDetails(request.body)
  if (!booking) {
    response.status(400).json({ message: guestLimitMessage(request.body) ?? 'Booking dates, accommodation, tour type, or guest details are invalid. Refresh the page and check the current rates.' })
    return
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  if (booking.checkInDate < today) {
    response.status(400).json({ message: 'Choose a check-in date from today onward.' })
    return
  }

  const bookingId = `TS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referenceNumber = nextReference('HOLD')
    try {
      const result = await createPendingHold({
        id: bookingId,
        userId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        referenceNumber,
        ...booking,
      })
      if (!result.ok) {
        response.status(409).json({ message: holdRefusalMessages[result.reason], reason: result.reason })
        return
      }
      response.status(201).json({ bookingId, referenceNumber, expiresAt: result.expiresAt.toISOString() })
      return
    } catch (error) {
      if (!uniqueViolation(error) || attempt === 4) throw error
    }
  }
  response.status(503).json({ message: 'Could not generate a unique hold reference. Please try again.' })
}

/** POST /api/admin/bookings/:id/confirm-hold-cash — admin received the full cash payment for a hold. */
export async function confirmHoldWithCash(request: AuthenticatedRequest, response: Response) {
  if (request.authUser?.role !== 'ADMIN') {
    response.status(403).json({ message: 'You do not have access to this page.' })
    return
  }
  const bookingId = request.params.id
  if (typeof bookingId !== 'string' || !bookingId) {
    response.status(400).json({ message: 'A valid booking ID is required.' })
    return
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cashReference = nextReference('CASH')
    try {
      const result = await confirmPendingHoldWithCash(bookingId, cashReference)
      if (result === 'CONFIRMED') {
        response.status(200).json({ message: 'Cash received. The hold is now a confirmed booking.', referenceNumber: cashReference })
      } else if (result === 'NOT_FOUND') {
        response.status(404).json({ message: 'Booking not found.' })
      } else if (result === 'EXPIRED') {
        response.status(409).json({ message: 'This walk-in voucher has already expired. Ask the guest to book again.' })
      } else if (result === 'DATE_TAKEN') {
        response.status(409).json({ message: 'These dates were already secured by a confirmed booking, so this hold cannot be confirmed.' })
      } else {
        response.status(409).json({ message: 'Only an active walk-in voucher can be confirmed this way.' })
      }
      return
    } catch (error) {
      if (!uniqueViolation(error) || attempt === 4) throw error
    }
  }
  response.status(503).json({ message: 'Could not generate a unique cash reference. Please try again.' })
}

export async function createWalkInBooking(request: AuthenticatedRequest, response: Response) {
  const adminUserId = request.authUser?.id
  const details = getBookingDetails(request.body)
  const body = request.body
  if (!adminUserId || request.authUser?.role !== 'ADMIN') {
    response.status(403).json({ message: 'You do not have access to this page.' })
    return
  }
  if (!details || !isRecord(body)) {
    response.status(400).json({ message: guestLimitMessage(body) ?? 'Enter valid walk-in dates, accommodation, tour type, and guests.' })
    return
  }
  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : ''
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  if (!customerName || customerName.length > 120 || details.checkInDate !== today) {
    response.status(400).json({ message: 'Enter a guest name and a valid same-day check-in date.' })
    return
  }
  if (customerEmail && (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
    response.status(400).json({ message: 'Enter a valid guest email address or leave it blank.' })
    return
  }

  const bookingId = `TS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referenceNumber = nextReference('CASH')
    try {
      const created = await createWalkInCashBooking({
        id: bookingId,
        adminUserId,
        customerName,
        customerEmail,
        referenceNumber,
        ...details,
      })
      if (!created) {
        response.status(409).json({ message: 'Those dates are already reserved. Check availability and try another accommodation or date.' })
        return
      }
      response.status(201).json({ bookingId, referenceNumber })
      return
    } catch (error) {
      if (!uniqueViolation(error) || attempt === 4) throw error
    }
  }
  response.status(503).json({ message: 'Could not generate a unique walk-in reference. Please try again.' })
}
