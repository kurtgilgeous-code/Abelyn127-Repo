import type { Booking, PaymentMethod } from '../data/bookings'

export async function errorMessage(response: Response) {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
      return body.message
    }
  } catch {
    return `Request failed (${response.status}).`
  }
  return `Request failed (${response.status}).`
}

/** What the booking endpoints need: one or more accommodations booked together. */
export type StayRequest = Pick<Booking, 'accommodationIds' | 'tourType' | 'checkInDate' | 'checkOutDate' | 'guests'> & {
  /** Guests beyond the rooms' pax, by type; omitted when every guest pays entrance. */
  extraGuests?: { adults: number; seniorsPwd: number; children: number }
}

export async function fetchAvailability(
  accommodationIds: string[],
  checkInDate: string,
  checkOutDate: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ accommodationIds: accommodationIds.join(','), checkInDate, checkOutDate })
  const response = await fetch(`/api/availability?${query}`, { signal })
  if (!response.ok) throw new Error(await errorMessage(response))

  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('available' in body) || typeof body.available !== 'boolean') {
    throw new Error('The server returned an invalid availability response.')
  }
  return {
    available: body.available,
    /** Another guest has an unexpired walk-in voucher on these dates (soft, not blocking). */
    pendingHold: 'pendingHold' in body && body.pendingHold === true,
    /** The resort closed these dates (maintenance / private use). */
    blocked: 'blocked' in body && body.blocked === true,
  }
}

/** Priority #2: a walk-in voucher, valid through the check-in date (no payment now). */
export async function createPendingHold(
  token: string,
  booking: StayRequest,
) {
  const response = await fetch('/api/bookings/pending-hold', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(booking),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' || body === null ||
    !('bookingId' in body) || typeof body.bookingId !== 'string' ||
    !('referenceNumber' in body) || typeof body.referenceNumber !== 'string' ||
    !('expiresAt' in body) || typeof body.expiresAt !== 'string'
  ) {
    throw new Error('The server returned an invalid pending-hold response.')
  }
  return { bookingId: body.bookingId, referenceNumber: body.referenceNumber, expiresAt: body.expiresAt }
}

/** Admin: the hold's guest paid the full rate in cash; convert it to a confirmed booking. */
export async function confirmHoldWithCash(token: string, bookingId: string) {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}/confirm-hold-cash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(await errorMessage(response))
}

async function readBookings(response: Response): Promise<Booking[]> {
  if (!response.ok) throw new Error(await errorMessage(response))
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('bookings' in body) || !Array.isArray(body.bookings)) {
    throw new Error('The server returned an invalid bookings response.')
  }
  return body.bookings as Booking[]
}

export async function fetchCustomerBookings(token: string, signal?: AbortSignal) {
  return readBookings(await fetch('/api/bookings/mine', {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  }))
}

export async function fetchAdminBookings(token: string) {
  return readBookings(await fetch('/api/admin/bookings', {
    headers: { Authorization: `Bearer ${token}` },
  }))
}

export async function createBookingRequest(
  token: string,
  booking: Omit<Booking, 'id' | 'referenceNumber' | 'paymentTier' | 'baseResortPrice' | 'baseDepositAmount' | 'gatewayFeeAmount' | 'totalOnlinePaid' | 'cashBalanceDue' | 'gatewayPaymentId' | 'createdAt' | 'status' | 'paymentStatus' | 'paymentAmount' | 'paidAmount' | 'paymentMethod' | 'paymentReference' | 'proofFileName' | 'hasPaymentProof' | 'payments' | 'expiresAt' | 'priorityRank' | 'holdReferenceNumber'>,
  payment: { amount: number; method: PaymentMethod; reference: string; payerAccount: string; proof: File },
) {
  const formData = new FormData()
  formData.append('booking', JSON.stringify(booking))
  formData.append('paymentAmount', String(payment.amount))
  formData.append('paymentMethod', payment.method)
  formData.append('paymentReference', payment.reference)
  formData.append('payerAccount', payment.payerAccount)
  formData.append('proof', payment.proof)
  const response = await fetch('/api/bookings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('id' in body) || typeof body.id !== 'string') {
    throw new Error('The server returned an invalid booking response.')
  }
  return body.id
}

export async function createGcashCheckout(
  token: string,
  booking: StayRequest,
) {
  const response = await fetch('/api/payments/create-gcash-checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(booking),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' || body === null ||
    !('bookingId' in body) || typeof body.bookingId !== 'string' ||
    !('referenceNumber' in body) || typeof body.referenceNumber !== 'string' ||
    !('checkoutUrl' in body) || typeof body.checkoutUrl !== 'string'
  ) {
    throw new Error('The server returned an invalid GCash checkout response.')
  }
  const checkoutUrl = new URL(body.checkoutUrl)
  const trustedHost = checkoutUrl.hostname === 'hit-pay.com' || checkoutUrl.hostname.endsWith('.hit-pay.com')
  if (checkoutUrl.protocol !== 'https:' || !trustedHost) {
    throw new Error('The server returned an untrusted GCash checkout URL.')
  }
  return {
    bookingId: body.bookingId,
    referenceNumber: body.referenceNumber,
    checkoutUrl: checkoutUrl.href,
  }
}

export async function createWalkInCashBooking(
  token: string,
  booking: StayRequest & {
    customerName: string
    customerEmail: string
  },
) {
  const response = await fetch('/api/admin/bookings/walk-in', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(booking),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' || body === null ||
    !('bookingId' in body) || typeof body.bookingId !== 'string' ||
    !('referenceNumber' in body) || typeof body.referenceNumber !== 'string'
  ) {
    throw new Error('The server returned an invalid walk-in booking response.')
  }
  return { bookingId: body.bookingId, referenceNumber: body.referenceNumber }
}

export async function submitPaymentProof(
  token: string,
  bookingId: string,
  input: { paymentMethod: PaymentMethod; paymentReference: string; payerAccount: string; paymentAmount: number; proof: File },
) {
  const formData = new FormData()
  formData.append('paymentMethod', input.paymentMethod)
  formData.append('paymentReference', input.paymentReference)
  formData.append('payerAccount', input.payerAccount)
  formData.append('paymentAmount', String(input.paymentAmount))
  formData.append('proof', input.proof)
  const response = await fetch(`/api/bookings/${encodeURIComponent(bookingId)}/payment-proof`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  })
  if (!response.ok) throw new Error(await errorMessage(response))
}

export async function updateBookingReview(
  token: string,
  bookingId: string,
  update: { status: Booking['status'] },
) {
  const response = await fetch(`/api/admin/bookings/${encodeURIComponent(bookingId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(update),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
}

export async function reviewPayment(
  token: string,
  bookingId: string,
  paymentId: string,
  received: boolean,
) {
  const response = await fetch(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/payments/${encodeURIComponent(paymentId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ received }),
    },
  )
  if (!response.ok) throw new Error(await errorMessage(response))
}

export async function recordCashPayment(token: string, bookingId: string, amount: number) {
  const response = await fetch(
    `/api/admin/bookings/${encodeURIComponent(bookingId)}/payments/cash`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount }),
    },
  )
  if (!response.ok) throw new Error(await errorMessage(response))
}
