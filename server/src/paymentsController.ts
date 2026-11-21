import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest } from './auth.js'
import {
  cancelUnpaidGcashReservation,
  confirmPendingHoldWithCash,
  createGcashReservation,
  createPendingHold,
  createWalkInCashBooking,
  MAX_ACTIVE_HOLDS_PER_USER,
  recordGatewayPayment,
  isAccommodationAvailable,
  saveGatewayCheckoutId,
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

function configuredOrigin(request: Request) {
  const configured = process.env.APP_ORIGIN?.split(',').map((origin) => origin.trim()).find(Boolean)
  if (configured) return configured.replace(/\/+$/, '')
  const requestOrigin = request.get('origin')
  if (process.env.NODE_ENV !== 'production' && requestOrigin) return requestOrigin.replace(/\/+$/, '')
  return null
}

function uniqueViolation(error: unknown) {
  return isRecord(error) && error.code === '23505'
}

// Online fee added on top of the deposit. HitPay's published GCash rate is 2.3% + VAT;
// confirm the rate on your HitPay account before going live.
const ONLINE_FEE_RATE = 0.025

type HitpayConfig = { apiKey: string, apiBase: string }

function hitpayConfig(): HitpayConfig | null {
  const apiKey = process.env.HITPAY_API_KEY?.trim()
  const mode = process.env.HITPAY_MODE?.trim().toLowerCase()
  if (!apiKey || (mode !== 'live' && mode !== 'sandbox')) return null
  return {
    apiKey,
    apiBase: mode === 'live' ? 'https://api.hit-pay.com/v1' : 'https://api.sandbox.hit-pay.com/v1',
  }
}

function hitpayHeaders(config: HitpayConfig) {
  return {
    'X-BUSINESS-API-KEY': config.apiKey,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'application/json',
  }
}

export async function createGcashCheckout(request: AuthenticatedRequest, response: Response) {
  const user = request.authUser
  if (!user?.id) {
    response.status(401).json({ message: 'Please sign in before reserving a date.' })
    return
  }
  const hitpay = hitpayConfig()
  const appOrigin = configuredOrigin(request)
  if (!hitpay || !appOrigin) {
    response.status(503).json({ message: 'Online GCash checkout is not configured. Please contact the resort.' })
    return
  }
  const booking = getBookingDetails(request.body)
  if (!booking) {
    response.status(400).json({ message: guestLimitMessage(request.body) ?? 'Booking dates, accommodation, tour type, or guest details are invalid. Refresh the page and check the current rates.' })
    return
  }

  if (!(await isAccommodationAvailable(booking.accommodationIds, booking.checkInDate, booking.checkOutDate))) {
    response.status(409).json({ message: 'These dates are no longer available (already confirmed or closed by the resort). Please choose another date or accommodation.' })
    return
  }

  const onlineCharge = Math.round((booking.baseDepositAmount / (1 - ONLINE_FEE_RATE)) * 100) / 100
  const gatewayFeeAmount = Math.round((onlineCharge - booking.baseDepositAmount) * 100) / 100
  const totalOnlinePaid = Math.round((booking.baseDepositAmount + gatewayFeeAmount) * 100) / 100
  const cashBalanceDue = Math.round((booking.baseResortPrice - booking.baseDepositAmount) * 100) / 100
  const bookingId = `TS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  let referenceNumber = ''

  for (let attempt = 0; attempt < 5; attempt += 1) {
    referenceNumber = nextReference('GCASH')
    try {
      await createGcashReservation({
        id: bookingId,
        userId: user.id,
        customerName: user.name,
        customerEmail: user.email,
        referenceNumber,
        ...booking,
        gatewayFeeAmount,
        totalOnlinePaid,
        cashBalanceDue,
      })
      break
    } catch (error) {
      if (!uniqueViolation(error) || attempt === 4) throw error
    }
  }

  const form = new URLSearchParams({
    amount: totalOnlinePaid.toFixed(2),
    currency: 'PHP',
    purpose: `50% resort deposit + online fee - ${booking.accommodationName}`.slice(0, 255),
    reference_number: referenceNumber,
    // HitPay appends ?reference=<payment request id>&status=<status> to this URL,
    // so the booking reference travels in the path instead of the query string.
    redirect_url: `${appOrigin}/booking/return/${encodeURIComponent(referenceNumber)}`,
    name: user.name.slice(0, 255),
    allow_repeated_payments: 'false',
    send_email: user.email ? 'true' : 'false',
  })
  form.append('payment_methods[]', 'gcash')
  if (user.email) form.set('email', user.email)

  let providerResponse: globalThis.Response
  try {
    providerResponse = await fetch(`${hitpay.apiBase}/payment-requests`, {
      method: 'POST',
      headers: { ...hitpayHeaders(hitpay), 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15_000),
      body: form,
    })
  } catch (error) {
    await cancelUnpaidGcashReservation(referenceNumber)
    console.error('HitPay payment request failed:', error)
    response.status(502).json({ message: 'Could not start GCash checkout. Please try again or contact the resort.' })
    return
  }

  let providerBody: unknown
  try {
    providerBody = await providerResponse.json()
  } catch {
    providerBody = null
  }
  if (!providerResponse.ok || !isRecord(providerBody) ||
      typeof providerBody.id !== 'string' || typeof providerBody.url !== 'string') {
    await cancelUnpaidGcashReservation(referenceNumber)
    console.error('HitPay rejected payment request creation:', providerResponse.status)
    response.status(502).json({ message: 'Could not start GCash checkout. Please try again or contact the resort.' })
    return
  }
  const saved = await saveGatewayCheckoutId(referenceNumber, providerBody.id)
  if (!saved) {
    await cancelUnpaidGcashReservation(referenceNumber)
    response.status(409).json({ message: 'This booking could not be prepared for checkout. Please try again.' })
    return
  }
  response.status(201).json({
    bookingId,
    referenceNumber,
    checkoutUrl: providerBody.url,
  })
}

export const holdRefusalMessages = {
  DATE_CONFIRMED: 'These dates were already secured by a confirmed booking. Please choose another date or accommodation.',
  DATE_BLOCKED: 'The resort has closed these dates (maintenance or private use). Please choose another date or accommodation.',
  ALREADY_HELD: 'You already have an active 24-hour hold on these dates. Pay in cash at the resort, or secure them now with the GCash deposit.',
  HOLD_LIMIT: `You can have up to ${MAX_ACTIVE_HOLDS_PER_USER} active 24-hour holds at a time. Wait for one to expire, or secure a date with the GCash deposit.`,
} as const

/** POST /api/bookings/pending-hold — Priority #2 "reserve now, pay cash later" 24-hour hold. */
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
    response.status(403).json({ message: 'Admin access is required to confirm a cash hold.' })
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
        response.status(409).json({ message: 'This 24-hour hold has already expired. Ask the guest to book again.' })
      } else if (result === 'DATE_TAKEN') {
        response.status(409).json({ message: 'These dates were already secured by a confirmed booking, so this hold cannot be confirmed.' })
      } else {
        response.status(409).json({ message: 'Only an active 24-hour pending hold can be confirmed this way.' })
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
    response.status(403).json({ message: 'Admin access is required to record a walk-in booking.' })
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

function validHitpaySignature(rawBody: Buffer, header: string | undefined, salt: string) {
  const actual = header?.trim().toLowerCase() ?? ''
  if (!/^[\da-f]{64}$/.test(actual)) return false
  const expected = createHmac('sha256', salt).update(rawBody).digest('hex')
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

// The webhook body is only used to learn which payment request changed. Its status,
// reference, and amount are always re-read from HitPay's API before recording a payment.
async function fetchHitpayPaymentRequest(config: HitpayConfig, paymentRequestId: string) {
  const providerResponse = await fetch(
    `${config.apiBase}/payment-requests/${encodeURIComponent(paymentRequestId)}`,
    { headers: hitpayHeaders(config), signal: AbortSignal.timeout(15_000) },
  )
  if (!providerResponse.ok) throw new Error(`HitPay status lookup failed with HTTP ${providerResponse.status}`)
  const body: unknown = await providerResponse.json()
  if (!isRecord(body) || body.id !== paymentRequestId || typeof body.status !== 'string') {
    throw new Error('HitPay status lookup returned an unexpected payload')
  }
  const succeeded = Array.isArray(body.payments)
    ? body.payments.find((payment) => isRecord(payment) && payment.status === 'succeeded')
    : undefined
  return {
    id: paymentRequestId,
    status: body.status,
    referenceNumber: typeof body.reference_number === 'string' ? body.reference_number : '',
    amount: Number(body.amount),
    currency: typeof body.currency === 'string' ? body.currency.toUpperCase() : '',
    paymentId: isRecord(succeeded) && typeof succeeded.id === 'string' ? succeeded.id : paymentRequestId,
  }
}

export async function hitpayWebhook(request: Request, response: Response) {
  const rawBody = Buffer.isBuffer(request.body) ? request.body : null
  const salt = process.env.HITPAY_WEBHOOK_SALT
  const hitpay = hitpayConfig()
  if (!salt || !hitpay) {
    response.status(503).json({ message: 'HitPay webhook is not configured.' })
    return
  }
  if (!rawBody || !validHitpaySignature(rawBody, request.get('Hitpay-Signature'), salt)) {
    response.status(400).json({ message: 'Invalid HitPay webhook signature.' })
    return
  }
  let payload: unknown
  try {
    payload = JSON.parse(rawBody.toString('utf8'))
  } catch {
    response.status(400).json({ message: 'Invalid HitPay webhook payload.' })
    return
  }
  const eventObject = request.get('Hitpay-Event-Object')
  if ((eventObject && eventObject !== 'payment_request') || !isRecord(payload) || typeof payload.id !== 'string') {
    response.status(200).json({ received: true })
    return
  }

  let paymentRequest: Awaited<ReturnType<typeof fetchHitpayPaymentRequest>>
  try {
    paymentRequest = await fetchHitpayPaymentRequest(hitpay, payload.id)
  } catch (error) {
    // A non-2xx response makes HitPay retry the webhook later.
    console.error('Could not verify HitPay payment request:', error)
    response.status(502).json({ message: 'Could not verify the payment with HitPay.' })
    return
  }
  if (paymentRequest.status !== 'completed' || paymentRequest.currency !== 'PHP' ||
      !paymentRequest.referenceNumber || !Number.isFinite(paymentRequest.amount)) {
    response.status(200).json({ received: true })
    return
  }
  const result = await recordGatewayPayment({
    referenceNumber: paymentRequest.referenceNumber,
    checkoutId: paymentRequest.id,
    gatewayPaymentId: paymentRequest.paymentId,
    amount: paymentRequest.amount,
  })
  if (!result) console.error('Verified HitPay payment did not match a pending booking:', paymentRequest.referenceNumber)
  response.status(200).json({ received: true })
}
