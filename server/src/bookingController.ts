import { randomUUID } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type { Request, Response } from 'express'
import type { AuthenticatedRequest } from './auth.js'
import {
  createBooking,
  findBookingPayment,
  findBooking,
  listAdminBookings,
  listBookingPayments,
  listCustomerBookings,
  recordCashPayment,
  reportBookingPayment,
  reviewBookingPayment,
  updateBookingReview,
  type BookingRecord,
  type PaymentRecord,
  type BookingStatus,
  type PaymentMethod,
  type TourType,
} from './db.js'
import { calculateServerBookingTotal } from './pricing.js'

const proofDirectory = process.env.PAYMENT_PROOF_DIR
  ? path.resolve(process.env.PAYMENT_PROOF_DIR)
  : fileURLToPath(new URL('../storage/payment-proofs/', import.meta.url))
const paymentMethods: PaymentMethod[] = ['GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER']
const bookingStatuses: BookingStatus[] = ['PENDING', 'CANCELLED']
const tourTypes: TourType[] = ['OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getBookingId(request: Request, response: Response) {
  const id = request.params.id
  if (typeof id !== 'string' || !id) {
    response.status(400).json({ message: 'A valid booking ID is required.' })
    return null
  }
  return id
}

function publicPayment(record: PaymentRecord) {
  return {
    id: record.id,
    amount: Number(record.amount),
    method: record.method,
    reference: record.reference,
    payerAccount: record.payer_account,
    source: record.source,
    status: record.status,
    submittedAt: record.created_at,
    verifiedAt: record.verified_at,
    proofFileName: record.proof_file_name,
    hasProof: Boolean(record.proof_storage_key),
  }
}

function publicBooking(record: BookingRecord, payments: PaymentRecord[]) {
  return {
    id: record.id,
    createdAt: record.created_at,
    customerName: record.customer_name,
    customerContact: record.customer_email,
    accommodationId: record.accommodation_id,
    accommodationName: record.accommodation_name,
    tourType: record.tour_type,
    checkInDate: record.check_in_date,
    checkOutDate: record.check_out_date,
    guests: {
      adults: record.adults,
      seniorsPwd: record.seniors_pwd,
      children: record.children,
    },
    guestCount: record.guest_count,
    estimatedTotal: Number(record.estimated_total),
    depositRequired: Number(record.deposit_required),
    paymentAmount: record.payment_amount === null ? null : Number(record.payment_amount),
    paidAmount: Number(record.paid_amount),
    status: record.status,
    paymentStatus: record.payment_status,
    paymentMethod: record.payment_method,
    paymentReference: record.payment_reference,
    proofFileName: record.proof_file_name,
    hasPaymentProof: Boolean(record.proof_storage_key),
    payments: payments.map(publicPayment),
  }
}

async function bookingsWithPayments(records: BookingRecord[]) {
  const payments = await listBookingPayments(records.map((record) => record.id))
  const paymentsByBooking = new Map<string, PaymentRecord[]>()
  for (const payment of payments) {
    const list = paymentsByBooking.get(payment.booking_id) ?? []
    list.push(payment)
    paymentsByBooking.set(payment.booking_id, list)
  }
  return records.map((record) => publicBooking(record, paymentsByBooking.get(record.id) ?? []))
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export async function createCustomerBooking(request: AuthenticatedRequest, response: Response) {
  const userId = request.authUser?.id
  const file = request.file
  let body: unknown
  try {
    body = typeof request.body?.booking === 'string'
      ? JSON.parse(request.body.booking)
      : null
  } catch {
    response.status(400).json({ message: 'Booking details are not valid JSON.' })
    return
  }
  if (!userId || !isRecord(body) || !file) {
    response.status(400).json({ message: 'Enter valid booking details and attach proof of payment.' })
    return
  }

  const paymentMethod = request.body.paymentMethod
  const paymentReference = typeof request.body.paymentReference === 'string'
    ? request.body.paymentReference.trim()
    : ''
  const payerAccount = typeof request.body.payerAccount === 'string'
    ? request.body.payerAccount.trim()
    : ''
  const paymentAmount = typeof request.body.paymentAmount === 'string' &&
    /^\d+(?:\.\d{1,2})?$/.test(request.body.paymentAmount)
    ? Number(request.body.paymentAmount)
    : Number.NaN
  if (!paymentMethods.includes(paymentMethod)) {
    response.status(400).json({ message: 'Choose GCash, Maya, bank transfer, or other.' })
    return
  }
  if (!paymentReference || paymentReference.length > 120) {
    response.status(400).json({ message: 'Enter the transaction reference number (120 characters or fewer).' })
    return
  }
  if (!payerAccount || payerAccount.length > 200) {
    response.status(400).json({ message: 'Enter the payer account name and number (200 characters or fewer).' })
    return
  }

  const adults = body.guests && isRecord(body.guests) && Number.isInteger(body.guests.adults) ? body.guests.adults as number : -1
  const seniorsPwd = body.guests && isRecord(body.guests) && Number.isInteger(body.guests.seniorsPwd) ? body.guests.seniorsPwd as number : -1
  const children = body.guests && isRecord(body.guests) && Number.isInteger(body.guests.children) ? body.guests.children as number : -1
  const guestCount = adults + seniorsPwd + children
  const estimatedTotal = body.estimatedTotal
  const depositRequired = body.depositRequired
  const tourType = body.tourType
  const expectedPricing = tourTypes.includes(tourType as TourType) &&
    typeof body.accommodationId === 'string' &&
    Number.isInteger(adults) && adults >= 0 &&
    Number.isInteger(seniorsPwd) && seniorsPwd >= 0 &&
    Number.isInteger(children) && children >= 0
    ? calculateServerBookingTotal(
      body.accommodationId,
      tourType as TourType,
      { adults, seniorsPwd, children },
      (Date.parse(`${body.checkOutDate}T00:00:00.000Z`) - Date.parse(`${body.checkInDate}T00:00:00.000Z`)) / 86_400_000,
    )
    : null
  if (
    typeof body.accommodationId !== 'string' || !body.accommodationId ||
    typeof body.accommodationName !== 'string' || !body.accommodationName ||
    !tourTypes.includes(tourType as TourType) ||
    !expectedPricing ||
    body.accommodationName !== expectedPricing.accommodationName ||
    !validDate(body.checkInDate) || !validDate(body.checkOutDate) ||
    body.checkOutDate <= body.checkInDate ||
    adults < 0 || seniorsPwd < 0 || children < 0 || guestCount < 1 ||
    typeof estimatedTotal !== 'number' || !Number.isFinite(estimatedTotal) ||
    typeof depositRequired !== 'number' || !Number.isFinite(depositRequired) ||
    Math.round(estimatedTotal * 100) !== Math.round(expectedPricing.total * 100) ||
    Math.round(depositRequired * 100) !== Math.round(expectedPricing.deposit * 100) ||
    !Number.isFinite(paymentAmount) || paymentAmount < expectedPricing.deposit || paymentAmount > expectedPricing.total
  ) {
    response.status(400).json({ message: 'Booking dates, tour type, guests, pricing, or initial payment amount are invalid. Refresh the page and check the current rates.' })
    return
  }

  const detected = imageType(file.buffer)
  if (!detected || detected.mime !== file.mimetype) {
    response.status(400).json({ message: 'Upload a valid PNG, JPEG, or WebP payment screenshot.' })
    return
  }

  const id = `TS-${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const storageKey = `${randomUUID()}${detected.extension}`
  await mkdir(proofDirectory, { recursive: true })
  const absolutePath = path.join(proofDirectory, storageKey)
  await writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 })
  try {
    await createBooking({
      id,
      userId,
      accommodationId: body.accommodationId,
      accommodationName: body.accommodationName,
      tourType: tourType as TourType,
      checkInDate: body.checkInDate,
      checkOutDate: body.checkOutDate,
      adults,
      seniorsPwd,
      children,
      guestCount,
      estimatedTotal: expectedPricing.total,
      depositRequired: expectedPricing.deposit,
      paymentAmount,
      paymentMethod,
      paymentReference,
      payerAccount,
      proofStorageKey: storageKey,
      proofFileName: path.basename(file.originalname).slice(0, 180) || `payment-proof${detected.extension}`,
    })
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined)
    throw error
  }
  response.status(201).json({ id })
}

export async function customerBookings(request: AuthenticatedRequest, response: Response) {
  const userId = request.authUser?.id
  if (!userId) {
    response.status(401).json({ message: 'Please sign in to view your bookings.' })
    return
  }
  const records = await listCustomerBookings(userId)
  response.json({ bookings: await bookingsWithPayments(records) })
}

export async function adminBookings(_request: Request, response: Response) {
  const records = await listAdminBookings()
  response.json({ bookings: await bookingsWithPayments(records) })
}

function imageType(buffer: Buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mime: 'image/png', extension: '.png' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mime: 'image/jpeg', extension: '.jpg' }
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: '.webp' }
  }
  return null
}

export async function submitPaymentProof(request: AuthenticatedRequest, response: Response) {
  const userId = request.authUser?.id
  const file = request.file
  const paymentMethod = request.body?.paymentMethod
  const paymentReference = typeof request.body?.paymentReference === 'string'
    ? request.body.paymentReference.trim()
    : ''
  const payerAccount = typeof request.body?.payerAccount === 'string'
    ? request.body.payerAccount.trim()
    : ''
  const paymentAmountValue = request.body?.paymentAmount
  const paymentAmount = typeof paymentAmountValue === 'string' &&
    /^\d+(?:\.\d{1,2})?$/.test(paymentAmountValue)
    ? Number(paymentAmountValue)
    : Number.NaN
  if (!userId || !file) {
    response.status(400).json({ message: 'Choose a payment method and attach a screenshot of the payment.' })
    return
  }
  if (!paymentMethods.includes(paymentMethod)) {
    response.status(400).json({ message: 'Choose GCash, Maya, bank transfer, or other.' })
    return
  }
  if (!paymentReference || paymentReference.length > 120) {
    response.status(400).json({ message: 'Enter the transaction reference number (120 characters or fewer).' })
    return
  }
  if (!payerAccount || payerAccount.length > 200) {
    response.status(400).json({ message: 'Enter the payer account name and number (200 characters or fewer).' })
    return
  }
  const detected = imageType(file.buffer)
  if (!detected || detected.mime !== file.mimetype) {
    response.status(400).json({ message: 'Upload a valid PNG, JPEG, or WebP image.' })
    return
  }

  const id = getBookingId(request, response)
  if (!id) return
  const previous = await findBooking(id)
  if (!previous || previous.user_id !== userId) {
    response.status(404).json({ message: 'Booking not found.' })
    return
  }
  const requiredPayment = Number(previous.paid_amount) > 0
    ? 0.01
    : Number(previous.deposit_required)
  const maximumPayment = Number(previous.estimated_total) - Number(previous.paid_amount)
  if (!Number.isFinite(paymentAmount) || paymentAmount < requiredPayment || paymentAmount > maximumPayment) {
    response.status(400).json({
      message: Number(previous.paid_amount) > 0
        ? `Payment must be more than zero and no more than the remaining balance of ${maximumPayment.toFixed(2)}.`
        : `Payment must be at least ${Number(previous.deposit_required).toFixed(2)} and no more than the total ${Number(previous.estimated_total).toFixed(2)}.`,
    })
    return
  }
  const storageKey = `${randomUUID()}${detected.extension}`
  await mkdir(proofDirectory, { recursive: true })
  const absolutePath = path.join(proofDirectory, storageKey)
  await writeFile(absolutePath, file.buffer, { flag: 'wx', mode: 0o600 })
  try {
    const updated = await reportBookingPayment({
      id,
      userId,
      paymentMethod,
      paymentReference,
      payerAccount,
      proofStorageKey: storageKey,
      proofFileName: path.basename(file.originalname).slice(0, 180) || `payment-proof${detected.extension}`,
      paymentAmount,
    })
    if (!updated) {
      await unlink(absolutePath)
      response.status(409).json({ message: 'Payment proof cannot be submitted for this booking in its current state.' })
      return
    }
  } catch (error) {
    await unlink(absolutePath).catch(() => undefined)
    throw error
  }
  response.json({ message: 'Payment proof sent to the resort for review.' })
}

export async function adminPaymentProof(request: Request, response: Response) {
  const id = getBookingId(request, response)
  if (!id) return
  const paymentId = request.params.paymentId
  if (typeof paymentId !== 'string' || !paymentId) {
    response.status(400).json({ message: 'A valid payment ID is required.' })
    return
  }
  const payment = await findBookingPayment(id, paymentId)
  if (!payment?.proof_storage_key) {
    response.status(404).json({ message: 'No payment proof is attached to this booking.' })
    return
  }
  const key = path.basename(payment.proof_storage_key)
  const absolutePath = path.join(proofDirectory, key)
  const detected = imageType(await readFile(absolutePath))
  if (!detected) {
    response.status(500).json({ message: 'The stored payment proof is not a supported image.' })
    return
  }
  response.setHeader('Content-Type', detected.mime)
  response.setHeader('Content-Disposition', `inline; filename="${path.basename(payment.proof_file_name ?? key).replace(/["\\]/g, '_')}"`)
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.sendFile(absolutePath)
}

export async function updateAdminBooking(request: Request, response: Response) {
  const id = getBookingId(request, response)
  if (!id) return
  const body: unknown = request.body
  if (!isRecord(body)) {
    response.status(400).json({ message: 'Provide a booking or payment status to update.' })
    return
  }
  const status = body.status
  if (
    status === undefined ||
    !bookingStatuses.includes(status as BookingStatus) ||
    status === 'CONFIRMED'
  ) {
    response.status(400).json({ message: 'Bookings are confirmed only after a payment is verified. You can cancel a booking here.' })
    return
  }

  const updated = await updateBookingReview({
    id,
    status: status as BookingStatus,
  })
  if (!updated) {
    response.status(404).json({ message: 'Booking not found.' })
    return
  }
  response.json({ message: 'Booking updated.' })
}

export async function reviewAdminPayment(request: Request, response: Response) {
  const bookingId = getBookingId(request, response)
  const paymentId = request.params.paymentId
  if (!bookingId) return
  if (typeof paymentId !== 'string' || !paymentId) {
    response.status(400).json({ message: 'A valid payment ID is required.' })
    return
  }
  const body: unknown = request.body
  if (!isRecord(body) || typeof body.received !== 'boolean') {
    response.status(400).json({ message: 'Choose whether the payment was received.' })
    return
  }
  const updated = await reviewBookingPayment({ bookingId, paymentId, received: body.received })
  if (!updated) {
    response.status(409).json({ message: 'This payment is no longer waiting for review.' })
    return
  }
  if (updated === 'DATE_UNAVAILABLE') {
    response.json({
      message: 'Payment received and recorded, but these dates were already secured by an earlier-verified booking. The booking is marked date unavailable and requires customer contact/refund follow-up.',
      dateUnavailable: true,
    })
    return
  }
  response.json({ message: body.received ? 'Payment confirmed as received.' : 'Payment marked as not received.' })
}

export async function recordAdminCashPayment(request: Request, response: Response) {
  const bookingId = getBookingId(request, response)
  if (!bookingId) return
  const body: unknown = request.body
  const amount = isRecord(body) ? body.amount : undefined
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    response.status(400).json({ message: 'Enter a valid cash payment amount.' })
    return
  }
  const recorded = await recordCashPayment({ bookingId, amount })
  if (!recorded) {
    response.status(409).json({ message: 'Cash cannot be recorded while a payment is under review, or the amount exceeds the remaining balance.' })
    return
  }
  if (recorded === 'DATE_UNAVAILABLE') {
    response.status(201).json({
      message: 'Cash was received and recorded, but these dates were already secured by an earlier-verified booking. The booking is marked date unavailable and requires customer contact/refund follow-up.',
      dateUnavailable: true,
    })
    return
  }
  response.status(201).json({ message: 'Cash payment recorded as received.' })
}
