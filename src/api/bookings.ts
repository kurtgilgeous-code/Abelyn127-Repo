import type { Booking, PaymentMethod } from '../data/bookings'

async function errorMessage(response: Response) {
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
  booking: Omit<Booking, 'id' | 'createdAt' | 'status' | 'paymentStatus' | 'paymentAmount' | 'paidAmount' | 'paymentMethod' | 'paymentReference' | 'proofFileName' | 'hasPaymentProof' | 'payments'>,
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
