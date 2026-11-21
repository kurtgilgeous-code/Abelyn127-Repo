import type { Booking, BookingPayment } from '../data/bookings'

/**
 * Earnings follow the payment hierarchy, on a cash basis:
 * - Only payments marked RECEIVED count, in the month they were verified (Philippine time).
 * - Tier 1 GCash (HitPay) payments include the separately itemized online gateway fee;
 *   that fee is passed through to the gateway, so resort earnings = amount − fee.
 * - Cash (walk-ins, confirmed 24-hour holds, balances collected at check-in) counts in full.
 * - Verified manual transfers (screenshot-reviewed GCash / Maya / bank) count in full.
 * - Money received on bookings that are DATE_UNAVAILABLE or CANCELLED is held for refund
 *   review and kept out of earnings until the admin settles it.
 */
export type EarningsChannel = 'gcash' | 'cash' | 'transfer'

export const channelOrder: EarningsChannel[] = ['gcash', 'cash', 'transfer']

export const channelLabels: Record<EarningsChannel, string> = {
  gcash: 'GCash reservation deposits',
  cash: 'Cash collected',
  transfer: 'Verified transfers',
}

export interface LedgerEntry {
  id: string
  receivedAt: string
  monthKey: string
  bookingId: string
  reference: string
  guest: string
  accommodation: string
  channel: EarningsChannel
  methodLabel: string
  gross: number
  gatewayFee: number
  net: number
  /** Received on a booking that needs refund follow-up; excluded from earnings. */
  refundReview: boolean
}

export interface MonthSummary {
  monthKey: string
  payments: number
  bookings: number
  byChannel: Record<EarningsChannel, number>
  gross: number
  gatewayFees: number
  net: number
  refundReview: number
  refundReviewCount: number
}

const round2 = (value: number) => Math.round(value * 100) / 100

export function manilaMonthKey(date: Date | string) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).slice(0, 7)
}

export function currentMonthKey() {
  return manilaMonthKey(new Date())
}

export function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`
}

export function monthLabel(monthKey: string, style: 'long' | 'short' = 'long') {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-PH', {
    timeZone: 'UTC',
    month: style,
    year: style === 'long' ? 'numeric' : '2-digit',
  })
}

function isGatewayPayment(booking: Booking, payment: BookingPayment) {
  return booking.paymentTier === 'ONLINE_GCASH_RESERVATION' &&
    payment.method === 'GCASH' &&
    Boolean(booking.gatewayPaymentId) &&
    payment.reference === booking.gatewayPaymentId
}

function methodLabel(payment: BookingPayment, gateway: boolean) {
  if (gateway) return 'GCash · HitPay'
  if (payment.method === 'CASH') return 'Cash'
  if (payment.method === 'BANK_TRANSFER') return 'Bank transfer'
  if (payment.method === 'MAYA') return 'Maya'
  if (payment.method === 'GCASH') return 'GCash · manual'
  return 'Other transfer'
}

/** One ledger line per payment the resort has actually received. */
export function buildLedger(bookings: Booking[]): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const booking of bookings) {
    const refundReview = booking.status === 'DATE_UNAVAILABLE' || booking.status === 'CANCELLED'
    for (const payment of booking.payments) {
      if (payment.status !== 'RECEIVED') continue
      const receivedAt = payment.verifiedAt ?? payment.submittedAt
      const gateway = isGatewayPayment(booking, payment)
      const gatewayFee = gateway ? Math.min(payment.amount, Number(booking.gatewayFeeAmount) || 0) : 0
      entries.push({
        id: payment.id,
        receivedAt,
        monthKey: manilaMonthKey(receivedAt),
        bookingId: booking.id,
        reference: booking.referenceNumber,
        guest: booking.customerName || 'Guest',
        accommodation: booking.accommodationName,
        channel: gateway ? 'gcash' : payment.method === 'CASH' ? 'cash' : 'transfer',
        methodLabel: methodLabel(payment, gateway),
        gross: round2(payment.amount),
        gatewayFee: round2(gatewayFee),
        net: round2(payment.amount - gatewayFee),
        refundReview,
      })
    }
  }
  return entries.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
}

function emptySummary(monthKey: string): MonthSummary {
  return {
    monthKey,
    payments: 0,
    bookings: 0,
    byChannel: { gcash: 0, cash: 0, transfer: 0 },
    gross: 0,
    gatewayFees: 0,
    net: 0,
    refundReview: 0,
    refundReviewCount: 0,
  }
}

export function summarizeMonth(ledger: LedgerEntry[], monthKey: string): MonthSummary {
  const summary = emptySummary(monthKey)
  const bookingIds = new Set<string>()
  for (const entry of ledger) {
    if (entry.monthKey !== monthKey) continue
    summary.payments += 1
    bookingIds.add(entry.bookingId)
    summary.gross += entry.gross
    summary.gatewayFees += entry.gatewayFee
    if (entry.refundReview) {
      summary.refundReview += entry.net
      summary.refundReviewCount += 1
    } else {
      summary.byChannel[entry.channel] += entry.net
      summary.net += entry.net
    }
  }
  summary.bookings = bookingIds.size
  summary.gross = round2(summary.gross)
  summary.gatewayFees = round2(summary.gatewayFees)
  summary.net = round2(summary.net)
  summary.refundReview = round2(summary.refundReview)
  for (const channel of channelOrder) summary.byChannel[channel] = round2(summary.byChannel[channel])
  return summary
}

/** Months from `count - 1` months before `endMonth` through `endMonth`, oldest first. */
export function monthRange(endMonth: string, count: number) {
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, index - count + 1))
}

/**
 * Balance still to be collected in cash for confirmed stays checking in during the month
 * (e.g. the 50% balance on GCash reservations). Expected income, not yet earned.
 */
export function cashToCollect(bookings: Booking[], monthKey: string) {
  return round2(bookings
    .filter((booking) => booking.status === 'CONFIRMED' && booking.checkInDate.slice(0, 7) === monthKey)
    .reduce((total, booking) => total + Math.max(0, booking.estimatedTotal - booking.paidAmount), 0))
}

/** Months a selector should offer: earliest month with a payment (or 11 months back) through now. */
export function selectableMonths(ledger: LedgerEntry[], nowMonth: string) {
  const earliestData = ledger[0]?.monthKey
  const floor = shiftMonth(nowMonth, -11)
  const start = earliestData && earliestData < floor ? earliestData : floor
  const months: string[] = []
  for (let month = nowMonth; month >= start; month = shiftMonth(month, -1)) months.push(month)
  return months
}

/** One CSV cell: quoted, with spreadsheet formula characters neutralized. */
function csvCell(value: string | number) {
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return `"${text.replace(/"/g, '""')}"`
}

/** The month's payment ledger as CSV (Manila time), for spreadsheets and bookkeeping. */
export function ledgerToCsv(entries: LedgerEntry[]) {
  const header = ['Received (Asia/Manila)', 'Reference', 'Guest', 'Accommodation', 'Channel', 'Method', 'Gross (PHP)', 'Gateway fee (PHP)', 'Net to resort (PHP)', 'Counted in earnings']
  const rows = entries.map((entry) => [
    new Date(entry.receivedAt).toLocaleString('en-CA', { timeZone: 'Asia/Manila', hour12: false }).replace(',', ''),
    entry.reference,
    entry.guest,
    entry.accommodation,
    channelLabels[entry.channel],
    entry.methodLabel,
    entry.gross.toFixed(2),
    entry.gatewayFee.toFixed(2),
    entry.net.toFixed(2),
    entry.refundReview ? 'No (held for refund review)' : 'Yes',
  ])
  return [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}
