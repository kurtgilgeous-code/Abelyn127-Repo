import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Pool, type PoolClient } from 'pg'
import { wholeResortAccommodationIds } from './pricing.js'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export interface UserRecord {
  id: string
  full_name: string
  email: string | null
  username: string
  password_hash: string
  role: 'ADMIN' | 'CUSTOMER'
}

export type BookingStatus =
  | 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DATE_UNAVAILABLE'
  | 'PENDING_HOLD' | 'EXPIRED' | 'CANCELLED_BY_GCASH_PRIORITY'
export type PaymentStatus = 'UNPAID' | 'PENDING_REVIEW' | 'PARTIALLY_PAID' | 'PAID' | 'NOT_PAID' | 'VOID'
export type PaymentMethod = 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER' | 'CASH'
export type TourType = 'OVERNIGHT' | 'DAY_TOUR' | 'NIGHT_TOUR'
export type PaymentTier = 'ONLINE_GCASH_RESERVATION' | 'WALKIN_CASH_NO_RESERVATION' | 'PENDING_CASH_INQUIRY'

/** A walk-in voucher stays valid through the end of its check-in date, Philippine time. */
export const voucherExpiresAt = (checkInDate: string) => new Date(`${checkInDate}T23:59:59.999+08:00`)
/** An unpaid GCash checkout is treated as abandoned after this many hours. */
export const ABANDONED_CHECKOUT_HOURS = 2
/** Active (unexpired) holds one account may have at once, so no one can tie up every date. */
export const MAX_ACTIVE_HOLDS_PER_USER = 2

export interface PaymentRecord {
  id: string
  booking_id: string
  amount: number
  method: PaymentMethod
  reference: string
  payer_account: string
  source: 'CUSTOMER' | 'ADMIN_CASH'
  status: 'PENDING_REVIEW' | 'RECEIVED' | 'NOT_RECEIVED'
  proof_storage_key: string | null
  proof_file_name: string | null
  created_at: Date
  verified_at: Date | null
}

export interface BookingRecord {
  id: string
  /** NULL once the customer's account has been removed (records are kept). */
  user_id: string | null
  customer_name: string
  customer_email: string
  reference_number: string
  payment_tier: PaymentTier | null
  base_resort_price: number
  base_deposit_amount: number
  gateway_fee_amount: number
  total_online_paid: number
  cash_balance_due: number
  gateway_payment_id: string | null
  gateway_checkout_id: string | null
  accommodation_id: string
  accommodation_ids: string[]
  accommodation_name: string
  tour_type: TourType
  check_in_date: string
  check_out_date: string
  adults: number
  seniors_pwd: number
  children: number
  guest_count: number
  /** JSON of the guests beyond the rooms' pax, by type; null on older bookings. */
  extra_guests: string | null
  estimated_total: number
  deposit_required: number
  status: BookingStatus
  payment_status: PaymentStatus
  payment_amount: number | null
  paid_amount: number
  payment_method: PaymentMethod | null
  payment_reference: string
  proof_storage_key: string | null
  proof_file_name: string | null
  created_at: Date
  expires_at: Date | null
  priority_rank: number | null
  hold_reference_number: string | null
}

/** Statuses in which a booking can no longer take payments through the normal payment flows. */
const inactiveForPaymentStatuses: string[] = [
  'CANCELLED', 'DATE_UNAVAILABLE', 'PENDING_HOLD', 'EXPIRED', 'CANCELLED_BY_GCASH_PRIORITY',
]
const inactiveForPaymentSql = inactiveForPaymentStatuses.map((status) => `'${status}'`).join(', ')

/**
 * SQL condition: rows `a` and `b` overlap in dates and compete for the same space (they
 * share an accommodation, or either one includes an exclusive whole-resort accommodation).
 * A booking can combine several accommodations (`accommodation_ids`).
 * `idsParam` is a parameter holding the whole-resort accommodation IDs as text[].
 */
function rowsOverlapSql(a: string, b: string, idsParam: string) {
  return `${a}.check_in_date < ${b}.check_out_date
    AND ${a}.check_out_date > ${b}.check_in_date
    AND (
      ${a}.accommodation_ids && ${b}.accommodation_ids
      OR ${a}.accommodation_ids && ${idsParam}::text[]
      OR ${b}.accommodation_ids && ${idsParam}::text[]
    )`
}

/**
 * SQL condition: `bookings` rows overlapping a requested stay given as parameters.
 * `accommodationsParam` holds the requested accommodation IDs as text[].
 */
function rangeOverlapSql(accommodationsParam: string, checkInParam: string, checkOutParam: string, idsParam: string) {
  return `check_in_date < ${checkOutParam}::date
    AND check_out_date > ${checkInParam}::date
    AND (
      accommodation_ids && ${accommodationsParam}::text[]
      OR accommodation_ids && ${idsParam}::text[]
      OR ${accommodationsParam}::text[] && ${idsParam}::text[]
    )`
}

/**
 * SQL condition: blocked_dates row `alias` closes a stay. A block with no accommodations
 * closes the whole resort; otherwise it closes only the listed accommodations.
 * `accommodations` is a text[] SQL expression; the dates are SQL date expressions.
 */
function blockOverlapSql(alias: string, accommodations: string, checkIn: string, checkOut: string) {
  return `${alias}.start_date < ${checkOut}
    AND ${alias}.end_date > ${checkIn}
    AND (cardinality(${alias}.accommodation_ids) = 0 OR ${alias}.accommodation_ids && ${accommodations})`
}

/** SELECT returning a blocked_dates id when the booking with id $1 falls on blocked dates. */
function blockedForBookingSelect(alias: string) {
  return `SELECT bd.id FROM blocked_dates AS bd, bookings AS ${alias}
       WHERE ${alias}.id = $1
         AND ${blockOverlapSql('bd', `${alias}.accommodation_ids`, `${alias}.check_in_date`, `${alias}.check_out_date`)}`
}

/**
 * First come, first served: dates belong to whichever booking is CONFIRMED first.
 * Once a booking is confirmed, every unpaid walk-in voucher on overlapping dates is released
 * (status CANCELLED_BY_GCASH_PRIORITY, shown as "Released · confirmed for another guest first").
 * Call inside the confirming transaction; it does nothing unless the booking is CONFIRMED.
 */
async function releaseOverlappingHolds(client: PoolClient, bookingId: string) {
  await client.query(
    `UPDATE bookings AS hold
     SET status = 'CANCELLED_BY_GCASH_PRIORITY', payment_status = 'NOT_PAID'
     FROM bookings AS confirmed
     WHERE confirmed.id = $1 AND confirmed.status = 'CONFIRMED'
       AND hold.id <> confirmed.id AND hold.status = 'PENDING_HOLD'
       AND ${rowsOverlapSql('hold', 'confirmed', '$2')}`,
    [bookingId, wholeResortAccommodationIds],
  )
}

let pool: Pool | undefined
let schemaPromise: Promise<void> | undefined

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('PostgreSQL is not configured. Set DATABASE_URL in the project root .env file.')
  }
  pool ??= new Pool({ connectionString: process.env.DATABASE_URL })
  return pool
}

export async function checkDatabaseConnection() {
  const result = await getPool().query('SELECT 1')
  return result.rowCount === 1
}

export async function ensureUserSchema() {
  if (!schemaPromise) {
    schemaPromise = getPool()
      .query(`
        CREATE TABLE IF NOT EXISTS users (
          id UUID PRIMARY KEY,
          full_name TEXT NOT NULL,
          email TEXT UNIQUE,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS bookings (
          id TEXT PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES users(id),
          customer_name TEXT NOT NULL DEFAULT '',
          customer_email TEXT NOT NULL DEFAULT '',
          reference_number TEXT,
          payment_tier TEXT,
          base_resort_price NUMERIC(12, 2),
          base_deposit_amount NUMERIC(12, 2),
          gateway_fee_amount NUMERIC(12, 2),
          total_online_paid NUMERIC(12, 2),
          cash_balance_due NUMERIC(12, 2),
          gateway_payment_id TEXT,
          gateway_checkout_id TEXT,
          accommodation_id TEXT NOT NULL,
          accommodation_name TEXT NOT NULL,
          tour_type TEXT NOT NULL DEFAULT 'OVERNIGHT' CHECK (tour_type IN ('OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR')),
          check_in_date DATE NOT NULL,
          check_out_date DATE NOT NULL CHECK (check_out_date > check_in_date),
          adults INTEGER NOT NULL CHECK (adults >= 0),
          seniors_pwd INTEGER NOT NULL CHECK (seniors_pwd >= 0),
          children INTEGER NOT NULL CHECK (children >= 0),
          guest_count INTEGER NOT NULL CHECK (guest_count > 0),
          estimated_total NUMERIC(12, 2) NOT NULL CHECK (estimated_total >= 0),
          deposit_required NUMERIC(12, 2) NOT NULL CHECK (deposit_required >= 0),
          payment_amount NUMERIC(12, 2),
          paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'PENDING'           CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'DATE_UNAVAILABLE')),
          payment_status TEXT NOT NULL DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PENDING_REVIEW', 'PAID', 'NOT_PAID', 'VOID')),
          payment_method TEXT CHECK (payment_method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER')),
          payment_reference TEXT NOT NULL DEFAULT '',
          proof_storage_key TEXT,
          proof_file_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '';
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference_number TEXT;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_tier TEXT;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_resort_price NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_deposit_amount NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gateway_fee_amount NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_online_paid NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cash_balance_due NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extra_guests TEXT;
        DO $migrate$
        BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'bookings'
                       AND column_name = 'paymongo_payment_id') THEN
            DROP INDEX IF EXISTS bookings_paymongo_payment_id_idx;
            ALTER TABLE bookings RENAME COLUMN paymongo_payment_id TO gateway_payment_id;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = current_schema() AND table_name = 'bookings'
                       AND column_name = 'paymongo_checkout_session_id') THEN
            ALTER TABLE bookings RENAME COLUMN paymongo_checkout_session_id TO gateway_checkout_id;
          END IF;
        END $migrate$;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gateway_checkout_id TEXT;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS priority_rank SMALLINT;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hold_reference_number TEXT;
        -- Safe user removal: deleting an account keeps its bookings and payments (revenue
        -- history); bookings.user_id becomes NULL instead of blocking the delete.
        ALTER TABLE bookings ALTER COLUMN user_id DROP NOT NULL;
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_user_id_fkey;
        ALTER TABLE bookings ADD CONSTRAINT bookings_user_id_fkey
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
        CREATE TABLE IF NOT EXISTS blocked_dates (
          id TEXT PRIMARY KEY,
          accommodation_ids TEXT[] NOT NULL DEFAULT '{}',
          start_date DATE NOT NULL,
          end_date DATE NOT NULL CHECK (end_date > start_date),
          reason TEXT NOT NULL DEFAULT '',
          created_by UUID REFERENCES users(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS blocked_dates_range_idx ON blocked_dates (start_date, end_date);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS accommodation_ids TEXT[];
        UPDATE bookings SET accommodation_ids = ARRAY[accommodation_id]
        WHERE accommodation_ids IS NULL OR cardinality(accommodation_ids) = 0;
        ALTER TABLE bookings ALTER COLUMN accommodation_ids SET NOT NULL;
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_accommodation_ids_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_accommodation_ids_check
          CHECK (cardinality(accommodation_ids) > 0 AND accommodation_id = accommodation_ids[1]);
        UPDATE bookings SET priority_rank = 1
        WHERE priority_rank IS NULL
          AND payment_tier IN ('ONLINE_GCASH_RESERVATION', 'WALKIN_CASH_NO_RESERVATION');
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_priority_rank_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_priority_rank_check
          CHECK (priority_rank IS NULL OR priority_rank IN (1, 2));
        UPDATE bookings
        SET reference_number = COALESCE(reference_number, 'TRP-LEGACY-' || id),
            base_resort_price = COALESCE(base_resort_price, estimated_total),
            base_deposit_amount = COALESCE(base_deposit_amount, deposit_required),
            gateway_fee_amount = COALESCE(gateway_fee_amount, 0),
            total_online_paid = COALESCE(total_online_paid, 0),
            cash_balance_due = COALESCE(cash_balance_due, GREATEST(estimated_total - paid_amount, 0))
        WHERE reference_number IS NULL
           OR base_resort_price IS NULL
           OR base_deposit_amount IS NULL
           OR gateway_fee_amount IS NULL
           OR total_online_paid IS NULL
           OR cash_balance_due IS NULL;
        ALTER TABLE bookings ALTER COLUMN reference_number SET NOT NULL;
        ALTER TABLE bookings ALTER COLUMN base_resort_price SET NOT NULL;
        ALTER TABLE bookings ALTER COLUMN base_deposit_amount SET NOT NULL;
        ALTER TABLE bookings ALTER COLUMN gateway_fee_amount SET NOT NULL;
        ALTER TABLE bookings ALTER COLUMN total_online_paid SET NOT NULL;
        ALTER TABLE bookings ALTER COLUMN cash_balance_due SET NOT NULL;
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_tier_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_payment_tier_check
          CHECK (payment_tier IS NULL OR payment_tier IN (
            'ONLINE_GCASH_RESERVATION', 'WALKIN_CASH_NO_RESERVATION', 'PENDING_CASH_INQUIRY'
          ));
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tour_type TEXT NOT NULL DEFAULT 'OVERNIGHT';
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_tour_type_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_tour_type_check
          CHECK (tour_type IN ('OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR'));
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
          CHECK (status IN (
            'PENDING', 'CONFIRMED', 'CANCELLED', 'DATE_UNAVAILABLE',
            'PENDING_HOLD', 'EXPIRED', 'CANCELLED_BY_GCASH_PRIORITY'
          ));
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check
          CHECK (payment_status IN ('UNPAID', 'PENDING_REVIEW', 'PARTIALLY_PAID', 'PAID', 'NOT_PAID', 'VOID'));
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_payment_method_check
          CHECK (payment_method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER', 'CASH'));
        CREATE TABLE IF NOT EXISTS booking_payments (
          id UUID PRIMARY KEY,
          booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
          amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
          method TEXT NOT NULL CHECK (method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER', 'CASH')),
          reference TEXT NOT NULL DEFAULT '',
          payer_account TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL CHECK (source IN ('CUSTOMER', 'ADMIN_CASH')),
          status TEXT NOT NULL CHECK (status IN ('PENDING_REVIEW', 'RECEIVED', 'NOT_RECEIVED')),
          proof_storage_key TEXT,
          proof_file_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          verified_at TIMESTAMPTZ
        );
        ALTER TABLE booking_payments ADD COLUMN IF NOT EXISTS payer_account TEXT NOT NULL DEFAULT '';
        CREATE INDEX IF NOT EXISTS booking_payments_booking_created_idx
          ON booking_payments (booking_id, created_at);
        CREATE UNIQUE INDEX IF NOT EXISTS bookings_reference_number_idx
          ON bookings (reference_number);
        CREATE UNIQUE INDEX IF NOT EXISTS bookings_gateway_payment_id_idx
          ON bookings (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS bookings_gateway_checkout_id_idx
          ON bookings (gateway_checkout_id) WHERE gateway_checkout_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS bookings_pending_hold_expiry_idx
          ON bookings (expires_at) WHERE status = 'PENDING_HOLD';
        CREATE INDEX IF NOT EXISTS bookings_user_created_idx ON bookings (user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS bookings_created_idx ON bookings (created_at DESC)
      `)
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaPromise = undefined
        throw error
      })
  }
  await schemaPromise
}

const bookingSelect = `
  SELECT b.id, b.user_id,
         COALESCE(NULLIF(b.customer_name, ''), u.full_name) AS customer_name,
         COALESCE(NULLIF(b.customer_email, ''), u.email, '') AS customer_email,
         b.reference_number, b.payment_tier, b.base_resort_price,
         b.base_deposit_amount, b.gateway_fee_amount, b.total_online_paid,
         b.cash_balance_due, b.gateway_payment_id, b.gateway_checkout_id,
         b.accommodation_id, b.accommodation_ids, b.accommodation_name,
         b.tour_type,
         b.check_in_date::text, b.check_out_date::text,
         b.adults, b.seniors_pwd, b.children, b.guest_count, b.extra_guests,
         b.estimated_total, b.deposit_required, b.payment_amount, b.paid_amount, b.status, b.payment_status,
         b.payment_method, b.payment_reference, b.proof_storage_key,
         b.proof_file_name, b.created_at, b.expires_at, b.priority_rank, b.hold_reference_number
  FROM bookings b
  LEFT JOIN users u ON u.id = b.user_id
`

export async function createBooking(input: {
  id: string
  userId: string
  customerName: string
  customerEmail: string
  accommodationIds: string[]
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  adults: number
  seniorsPwd: number
  children: number
  guestCount: number
  extraGuests?: { adults: number; seniorsPwd: number; children: number } | null
  estimatedTotal: number
  depositRequired: number
  paymentAmount: number
  paymentMethod: PaymentMethod
  paymentReference: string
  payerAccount: string
  proofStorageKey: string
  proofFileName: string
}) {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query(
    `INSERT INTO bookings (
       id, user_id, customer_name, customer_email, reference_number,
       base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid, cash_balance_due,
       accommodation_id, accommodation_name, check_in_date,
       tour_type, check_out_date, adults, seniors_pwd, children, guest_count,
       estimated_total, deposit_required, payment_status, payment_amount,
       payment_method, payment_reference, proof_storage_key, proof_file_name, accommodation_ids, extra_guests
     ) VALUES ($1, $2, $3, $4, 'TRP-LEGACY-' || $1, $5, $6, 0, 0, $5, ($7::text[])[1], $8, $9, $10, $11, $12, $13, $14, $15, $5, $6, 'PENDING_REVIEW', $16, $17, $18, $19, $20, $7::text[], $21)`,
    [
      input.id, input.userId, input.customerName, input.customerEmail,
      input.estimatedTotal, input.depositRequired,
      input.accommodationIds, input.accommodationName,
      input.checkInDate, input.tourType, input.checkOutDate, input.adults, input.seniorsPwd,
      input.children, input.guestCount,
      input.paymentAmount, input.paymentMethod, input.paymentReference,
      input.proofStorageKey, input.proofFileName, input.extraGuests ? JSON.stringify(input.extraGuests) : null,
    ],
    )
    await client.query(
      `INSERT INTO booking_payments (
           id, booking_id, amount, method, reference, payer_account, source, status,
         proof_storage_key, proof_file_name
         ) VALUES ($1, $2, $3, $4, $5, $6, 'CUSTOMER', 'PENDING_REVIEW', $7, $8)`,
      [
        randomUUID(), input.id, input.paymentAmount, input.paymentMethod,
        input.paymentReference, input.payerAccount, input.proofStorageKey, input.proofFileName,
      ],
    )
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function createGcashReservation(input: {
  id: string
  userId: string
  customerName: string
  customerEmail: string
  referenceNumber: string
  accommodationIds: string[]
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  adults: number
  seniorsPwd: number
  children: number
  guestCount: number
  extraGuests?: { adults: number; seniorsPwd: number; children: number } | null
  baseResortPrice: number
  baseDepositAmount: number
  gatewayFeeAmount: number
  totalOnlinePaid: number
  cashBalanceDue: number
}) {
  await ensureUserSchema()
  await getPool().query(
    `INSERT INTO bookings (
       id, user_id, customer_name, customer_email, reference_number, payment_tier,
       base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
       cash_balance_due, accommodation_id, accommodation_name, tour_type,
       check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
       estimated_total, deposit_required, payment_amount, paid_amount, status,
       payment_status, payment_method, payment_reference, priority_rank, accommodation_ids, extra_guests
     ) VALUES (
       $1, $2, $3, $4, $5, 'ONLINE_GCASH_RESERVATION',
       $6, $7, $8, $9, $10, ($11::text[])[1], $12, $13, $14, $15, $16, $17,
       $18, $19, $6, $7, $9, 0, 'PENDING', 'UNPAID', 'GCASH', $5, 1, $11::text[], $20
     )`,
    [
      input.id, input.userId, input.customerName, input.customerEmail,
      input.referenceNumber, input.baseResortPrice, input.baseDepositAmount,
      input.gatewayFeeAmount, input.totalOnlinePaid, input.cashBalanceDue,
      input.accommodationIds, input.accommodationName, input.tourType,
      input.checkInDate, input.checkOutDate, input.adults, input.seniorsPwd,
      input.children, input.guestCount, input.extraGuests ? JSON.stringify(input.extraGuests) : null,
    ],
  )
}

export async function saveGatewayCheckoutId(referenceNumber: string, checkoutId: string) {
  await ensureUserSchema()
  const result = await getPool().query(
    `UPDATE bookings
     SET gateway_checkout_id = $2
     WHERE reference_number = $1 AND payment_tier = 'ONLINE_GCASH_RESERVATION'
       AND status = 'PENDING' AND gateway_checkout_id IS NULL`,
    [referenceNumber, checkoutId],
  )
  return result.rowCount === 1
}

export async function cancelUnpaidGcashReservation(referenceNumber: string) {
  await ensureUserSchema()
  await getPool().query(
    `UPDATE bookings
     SET status = 'CANCELLED', payment_status = 'NOT_PAID'
     WHERE reference_number = $1 AND payment_tier = 'ONLINE_GCASH_RESERVATION'
       AND payment_status = 'UNPAID'`,
    [referenceNumber],
  )
}

/** Marks every pending cash hold past its check-in date as EXPIRED. Returns how many expired. */
export async function expirePendingHolds() {
  await ensureUserSchema()
  const holds = await getPool().query(
    `UPDATE bookings
     SET status = 'EXPIRED', payment_status = 'NOT_PAID'
     WHERE status = 'PENDING_HOLD' AND expires_at <= clock_timestamp()`,
  )
  // Unfinished GCash checkouts. A late payment is still recorded by recordGatewayPayment.
  const checkouts = await getPool().query(
    `UPDATE bookings
     SET status = 'EXPIRED', payment_status = 'NOT_PAID'
     WHERE status = 'PENDING' AND payment_status = 'UNPAID'
       AND payment_tier = 'ONLINE_GCASH_RESERVATION' AND gateway_payment_id IS NULL
       AND created_at <= clock_timestamp() - ($1::int * interval '1 hour')`,
    [ABANDONED_CHECKOUT_HOURS],
  )
  return (holds.rowCount ?? 0) + (checkouts.rowCount ?? 0)
}

/** Whether an unexpired pending cash hold overlaps the requested stay. */
export async function hasActivePendingHold(accommodationIds: string[], checkInDate: string, checkOutDate: string) {
  await ensureUserSchema()
  const result = await getPool().query<{ held: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM bookings
       WHERE status = 'PENDING_HOLD' AND expires_at > clock_timestamp()
         AND ${rangeOverlapSql('$1', '$2', '$3', '$4')}
     ) AS held`,
    [accommodationIds, checkInDate, checkOutDate, wholeResortAccommodationIds],
  )
  return Boolean(result.rows[0]?.held)
}

export type PendingHoldResult =
  | { ok: true, expiresAt: Date }
  | { ok: false, reason: 'DATE_CONFIRMED' | 'DATE_BLOCKED' | 'ALREADY_HELD' | 'HOLD_LIMIT' }

/**
 * Creates a Priority #2 "reserve now, pay cash later" hold that expires after its check-in date.
 * Runs under the same advisory lock as payment confirmations so a hold and a GCash
 * confirmation for the same slot are always decided one after the other.
 */
export async function createPendingHold(input: {
  id: string
  userId: string
  customerName: string
  customerEmail: string
  referenceNumber: string
  accommodationIds: string[]
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  adults: number
  seniorsPwd: number
  children: number
  guestCount: number
  extraGuests?: { adults: number; seniorsPwd: number; children: number } | null
  baseResortPrice: number
  baseDepositAmount: number
}): Promise<PendingHoldResult> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    await client.query(
      `UPDATE bookings SET status = 'EXPIRED', payment_status = 'NOT_PAID'
       WHERE status = 'PENDING_HOLD' AND expires_at <= clock_timestamp()`,
    )
    const activeHolds = await client.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM bookings WHERE user_id = $1 AND status = 'PENDING_HOLD'`,
      [input.userId],
    )
    if (Number(activeHolds.rows[0]?.count ?? 0) >= MAX_ACTIVE_HOLDS_PER_USER) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'HOLD_LIMIT' }
    }
    // Only a confirmed booking takes the date. Other guests' holds don't: the date stays
    // open to everyone, and whoever is confirmed first gets it.
    const conflicts = await client.query<{ status: string, user_id: string }>(
      `SELECT status, user_id::text AS user_id FROM bookings
       WHERE status IN ('CONFIRMED', 'PENDING_HOLD')
         AND ${rangeOverlapSql('$1', '$2', '$3', '$4')}`,
      [input.accommodationIds, input.checkInDate, input.checkOutDate, wholeResortAccommodationIds],
    )
    if (conflicts.rows.some((row) => row.status === 'CONFIRMED')) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'DATE_CONFIRMED' }
    }
    const blocked = await client.query(
      `SELECT 1 FROM blocked_dates AS bd
       WHERE ${blockOverlapSql('bd', '$1::text[]', '$2::date', '$3::date')} LIMIT 1`,
      [input.accommodationIds, input.checkInDate, input.checkOutDate],
    )
    if (blocked.rowCount) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'DATE_BLOCKED' }
    }
    if (conflicts.rows.some((row) => row.status === 'PENDING_HOLD' && row.user_id === input.userId)) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'ALREADY_HELD' }
    }
    const inserted = await client.query<{ expires_at: Date }>(
      `INSERT INTO bookings (
         id, user_id, customer_name, customer_email, reference_number, payment_tier,
         base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
         cash_balance_due, accommodation_id, accommodation_name, tour_type,
         check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
         estimated_total, deposit_required, paid_amount, status, payment_status,
         payment_reference, priority_rank, expires_at, accommodation_ids, extra_guests
       ) VALUES (
         $1, $2, $3, $4, $5, 'PENDING_CASH_INQUIRY',
         $6, $7, 0, 0, $6, ($8::text[])[1], $9, $10, $11, $12, $13, $14, $15, $16,
         $6, $7, 0, 'PENDING_HOLD', 'UNPAID', $5, 2,
         $17::timestamptz, $8::text[], $18
       )
       RETURNING expires_at`,
      [
        input.id, input.userId, input.customerName, input.customerEmail, input.referenceNumber,
        input.baseResortPrice, input.baseDepositAmount, input.accommodationIds, input.accommodationName,
        input.tourType, input.checkInDate, input.checkOutDate, input.adults, input.seniorsPwd,
        input.children, input.guestCount, voucherExpiresAt(input.checkInDate), input.extraGuests ? JSON.stringify(input.extraGuests) : null,
      ],
    )
    await client.query('COMMIT')
    return { ok: true, expiresAt: inserted.rows[0].expires_at }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export type ConfirmHoldResult = 'CONFIRMED' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'EXPIRED' | 'DATE_TAKEN'

/**
 * Admin action: the hold's guest paid the full base rate in cash before the hold expired.
 * Converts it into a confirmed cash booking with a new TRP-CASH reference, keeping the
 * original TRP-HOLD reference in hold_reference_number.
 */
export async function confirmPendingHoldWithCash(bookingId: string, cashReference: string): Promise<ConfirmHoldResult> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const holdResult = await client.query<{ status: string, expired: boolean, base_resort_price: string }>(
      `SELECT status, expires_at <= clock_timestamp() AS expired, base_resort_price
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [bookingId],
    )
    const hold = holdResult.rows[0]
    if (!hold) {
      await client.query('ROLLBACK')
      return 'NOT_FOUND'
    }
    if (hold.status !== 'PENDING_HOLD') {
      await client.query('ROLLBACK')
      return hold.status === 'EXPIRED' ? 'EXPIRED' : 'NOT_ACTIVE'
    }
    if (hold.expired) {
      await client.query(
        `UPDATE bookings SET status = 'EXPIRED', payment_status = 'NOT_PAID' WHERE id = $1`,
        [bookingId],
      )
      await client.query('COMMIT')
      return 'EXPIRED'
    }
    const taken = await client.query(
      `SELECT other.id FROM bookings AS other, bookings AS hold
       WHERE hold.id = $1 AND other.id <> hold.id AND other.status = 'CONFIRMED'
         AND ${rowsOverlapSql('other', 'hold', '$2')}
       UNION ALL
       ${blockedForBookingSelect('hold')}
       LIMIT 1`,
      [bookingId, wholeResortAccommodationIds],
    )
    if (taken.rowCount) {
      await client.query('ROLLBACK')
      return 'DATE_TAKEN'
    }
    await client.query(
      `UPDATE bookings
       SET status = 'CONFIRMED', payment_status = 'PAID', payment_tier = 'WALKIN_CASH_NO_RESERVATION',
           payment_method = 'CASH', payment_amount = base_resort_price, paid_amount = base_resort_price,
           hold_reference_number = reference_number, reference_number = $2, payment_reference = $2,
           priority_rank = 1, expires_at = NULL
       WHERE id = $1`,
      [bookingId, cashReference],
    )
    await client.query(
      `INSERT INTO booking_payments (
         id, booking_id, amount, method, reference, payer_account, source, status, verified_at
       ) VALUES ($1, $2, $3, 'CASH', $4, '', 'ADMIN_CASH', 'RECEIVED', clock_timestamp())`,
      [randomUUID(), bookingId, Number(hold.base_resort_price), cashReference],
    )
    await releaseOverlappingHolds(client, bookingId)
    await client.query('COMMIT')
    return 'CONFIRMED'
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function createWalkInCashBooking(input: {
  id: string
  adminUserId: string
  customerName: string
  customerEmail: string
  referenceNumber: string
  accommodationIds: string[]
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  adults: number
  seniorsPwd: number
  children: number
  guestCount: number
  extraGuests?: { adults: number; seniorsPwd: number; children: number } | null
  baseResortPrice: number
}): Promise<boolean> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const overlap = await client.query(
      `SELECT id
       FROM bookings
       WHERE status = 'CONFIRMED'
         AND ${rangeOverlapSql('$1', '$2', '$3', '$4')}
       UNION ALL
       SELECT id FROM blocked_dates AS bd
       WHERE ${blockOverlapSql('bd', '$1::text[]', '$2::date', '$3::date')}
       LIMIT 1`,
      [input.accommodationIds, input.checkInDate, input.checkOutDate, wholeResortAccommodationIds],
    )
    if (overlap.rowCount) {
      await client.query('ROLLBACK')
      return false
    }

    await client.query(
      `INSERT INTO bookings (
         id, user_id, customer_name, customer_email, reference_number, payment_tier,
         base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
         cash_balance_due, accommodation_id, accommodation_name, tour_type,
         check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
         estimated_total, deposit_required, payment_amount, paid_amount, status,
         payment_status, payment_method, payment_reference, priority_rank, accommodation_ids, extra_guests
       ) VALUES (
         $1, $2, $3, $4, $5, 'WALKIN_CASH_NO_RESERVATION',
         $6, 0, 0, 0, $6, ($7::text[])[1], $8, $9, $10, $11, $12, $13,
         $14, $15, $6, 0, $6, $6, 'CONFIRMED', 'PAID', 'CASH', $5, 1, $7::text[], $16
       )`,
      [
        input.id, input.adminUserId, input.customerName, input.customerEmail,
        input.referenceNumber, input.baseResortPrice, input.accommodationIds,
        input.accommodationName, input.tourType, input.checkInDate,
        input.checkOutDate, input.adults, input.seniorsPwd, input.children,
        input.guestCount, input.extraGuests ? JSON.stringify(input.extraGuests) : null,
      ],
    )
    await client.query(
      `INSERT INTO booking_payments (
         id, booking_id, amount, method, reference, payer_account, source, status, verified_at
       ) VALUES ($1, $2, $3, 'CASH', $4, '', 'ADMIN_CASH', 'RECEIVED', clock_timestamp())`,
      [randomUUID(), input.id, input.baseResortPrice, input.referenceNumber],
    )
    await releaseOverlappingHolds(client, input.id)
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function recordGatewayPayment(input: {
  referenceNumber: string
  checkoutId: string
  gatewayPaymentId: string
  amount: number
}): Promise<false | 'DATE_UNAVAILABLE' | true> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const result = await client.query(
      `SELECT id, payment_tier, payment_status, status, gateway_payment_id,
              gateway_checkout_id, total_online_paid, base_deposit_amount, accommodation_id,
              check_in_date, check_out_date
       FROM bookings WHERE reference_number = $1 FOR UPDATE`,
      [input.referenceNumber],
    )
    const booking = result.rows[0]
    if (
      !booking || booking.payment_tier !== 'ONLINE_GCASH_RESERVATION' ||
      booking.gateway_checkout_id !== input.checkoutId
    ) {
      await client.query('ROLLBACK')
      return false
    }
    if (booking.gateway_payment_id === input.gatewayPaymentId) {
      await client.query('ROLLBACK')
      return true
    }
    if (
      booking.gateway_payment_id ||
      // An expired checkout can still be paid late: the guest's money must always be recorded.
      !((booking.status === 'PENDING' && booking.payment_status === 'UNPAID') ||
        (booking.status === 'EXPIRED' && booking.payment_status === 'NOT_PAID')) ||
      Math.round(Number(booking.total_online_paid) * 100) !== Math.round(input.amount * 100)
    ) {
      await client.query('ROLLBACK')
      return false
    }

    const overlap = await client.query(
      `SELECT other.id
       FROM bookings AS other, bookings AS me
       WHERE me.id = $1 AND other.id <> me.id AND other.status = 'CONFIRMED'
         AND ${rowsOverlapSql('other', 'me', '$2')}
       UNION ALL
       ${blockedForBookingSelect('me')}
       LIMIT 1`,
      [booking.id, wholeResortAccommodationIds],
    )
    const dateUnavailable = Boolean(overlap.rowCount)
    await client.query(
      `INSERT INTO booking_payments (
         id, booking_id, amount, method, reference, payer_account, source, status, verified_at
       ) VALUES ($1, $2, $3, 'GCASH', $4, '', 'CUSTOMER', 'RECEIVED', clock_timestamp())`,
      [randomUUID(), booking.id, input.amount, input.gatewayPaymentId],
    )
    await client.query(
      `UPDATE bookings
       SET paid_amount = base_deposit_amount,
           payment_status = 'PARTIALLY_PAID',
           status = $2,
           gateway_payment_id = $3
       WHERE id = $1`,
      [booking.id, dateUnavailable ? 'DATE_UNAVAILABLE' : 'CONFIRMED', input.gatewayPaymentId],
    )
    // Priority #1: a paid GCash reservation takes the slot from any unpaid hold.
    if (!dateUnavailable) await releaseOverlappingHolds(client, booking.id)
    await client.query('COMMIT')
    return dateUnavailable ? 'DATE_UNAVAILABLE' : true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function listCustomerBookings(userId: string) {
  await ensureUserSchema()
  const result = await getPool().query<BookingRecord>(
    `${bookingSelect} WHERE b.user_id = $1 ORDER BY b.created_at DESC`,
    [userId],
  )
  return result.rows
}

export async function listAdminBookings() {
  await ensureUserSchema()
  const result = await getPool().query<BookingRecord>(
    `${bookingSelect} ORDER BY b.created_at DESC`,
  )
  return result.rows
}

export async function isAccommodationAvailable(
  accommodationIds: string[],
  checkInDate: string,
  checkOutDate: string,
) {
  await ensureUserSchema()
  const result = await getPool().query<{ available: boolean }>(
    `SELECT NOT EXISTS (
       SELECT 1 FROM bookings
       WHERE status = 'CONFIRMED'
         AND ${rangeOverlapSql('$1', '$2', '$3', '$4')}
     ) AND NOT EXISTS (
       SELECT 1 FROM blocked_dates AS bd
       WHERE ${blockOverlapSql('bd', '$1::text[]', '$2::date', '$3::date')}
     ) AS available`,
    [accommodationIds, checkInDate, checkOutDate, wholeResortAccommodationIds],
  )
  const row = result.rows[0]
  if (!row) throw new Error('Could not check accommodation availability.')
  return row.available
}

export async function findBooking(id: string) {
  await ensureUserSchema()
  const result = await getPool().query<BookingRecord>(
    `${bookingSelect} WHERE b.id = $1 LIMIT 1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function listBookingPayments(bookingIds: string[]) {
  await ensureUserSchema()
  if (bookingIds.length === 0) return []
  const result = await getPool().query<PaymentRecord>(
    `SELECT id, booking_id, amount, method, reference, payer_account, source, status,
            proof_storage_key, proof_file_name, created_at, verified_at
     FROM booking_payments
     WHERE booking_id = ANY($1::text[])
     ORDER BY created_at`,
    [bookingIds],
  )
  return result.rows
}

export async function findBookingPayment(bookingId: string, paymentId: string) {
  await ensureUserSchema()
  const result = await getPool().query<PaymentRecord>(
    `SELECT id, booking_id, amount, method, reference, payer_account, source, status,
            proof_storage_key, proof_file_name, created_at, verified_at
     FROM booking_payments
     WHERE booking_id = $1 AND id = $2`,
    [bookingId, paymentId],
  )
  return result.rows[0] ?? null
}

export async function reportBookingPayment(input: {
  id: string
  userId: string
  paymentMethod: PaymentMethod
  paymentReference: string
  payerAccount: string
  proofStorageKey: string
  proofFileName: string
  paymentAmount: number
}) {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const bookingResult = await client.query(
      `SELECT status, payment_status, deposit_required, estimated_total, paid_amount
       FROM bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [input.id, input.userId],
    )
    const booking = bookingResult.rows[0]
    if (!booking || inactiveForPaymentStatuses.includes(booking.status) || booking.payment_status === 'PENDING_REVIEW' || booking.payment_status === 'PAID') {
      await client.query('ROLLBACK')
      return false
    }
    const remaining = Number(booking.estimated_total) - Number(booking.paid_amount)
    const minimum = Number(booking.paid_amount) === 0 ? Number(booking.deposit_required) : 0.01
    if (input.paymentAmount < minimum || input.paymentAmount > remaining) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query(
      `INSERT INTO booking_payments (
         id, booking_id, amount, method, reference, payer_account, source, status,
         proof_storage_key, proof_file_name
       ) VALUES ($1, $2, $3, $4, $5, $6, 'CUSTOMER', 'PENDING_REVIEW', $7, $8)`,
      [
        randomUUID(), input.id, input.paymentAmount, input.paymentMethod,
        input.paymentReference, input.payerAccount, input.proofStorageKey, input.proofFileName,
      ],
    )
    await client.query(
      `UPDATE bookings
       SET payment_status = 'PENDING_REVIEW', payment_amount = $2,
           payment_method = $3, payment_reference = $4,
           proof_storage_key = $5, proof_file_name = $6
       WHERE id = $1`,
      [
        input.id, input.paymentAmount, input.paymentMethod, input.paymentReference,
        input.proofStorageKey, input.proofFileName,
      ],
    )
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function reviewBookingPayment(input: {
  bookingId: string
  paymentId: string
  received: boolean
}): Promise<false | 'DATE_UNAVAILABLE' | true> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const accommodationResult = await client.query<{ accommodation_id: string }>(
      'SELECT accommodation_id FROM bookings WHERE id = $1',
      [input.bookingId],
    )
    const accommodationId = accommodationResult.rows[0]?.accommodation_id
    if (!accommodationId) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const result = await client.query(
      `SELECT p.amount, b.estimated_total, b.paid_amount, b.accommodation_id,
              b.check_in_date, b.check_out_date
       FROM booking_payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.id = $1 AND p.booking_id = $2
         AND p.status = 'PENDING_REVIEW'
       AND b.status NOT IN (${inactiveForPaymentSql})
       FOR UPDATE OF p, b`,
      [input.paymentId, input.bookingId],
    )
    const payment = result.rows[0]
    if (!payment) {
      await client.query('ROLLBACK')
      return false
    }
    if (input.received) {
      const newPaidAmount = Number(payment.paid_amount) + Number(payment.amount)
      if (newPaidAmount > Number(payment.estimated_total)) {
        await client.query('ROLLBACK')
        return false
      }
      const overlapResult = await client.query(
        `SELECT other.id
         FROM bookings AS other, bookings AS me
         WHERE me.id = $1 AND other.id <> me.id AND other.status = 'CONFIRMED'
           AND ${rowsOverlapSql('other', 'me', '$2')}
         UNION ALL
         ${blockedForBookingSelect('me')}
         LIMIT 1`,
        [input.bookingId, wholeResortAccommodationIds],
      )
      const dateUnavailable = overlapResult.rowCount !== 0
      await client.query(
        `UPDATE booking_payments
         SET status = 'RECEIVED', verified_at = clock_timestamp()
         WHERE id = $1`,
        [input.paymentId],
      )
      await client.query(
        `UPDATE bookings
         SET paid_amount = $2,
             payment_status = CASE WHEN $2 >= estimated_total THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
             status = $3
         WHERE id = $1`,
        [input.bookingId, newPaidAmount, dateUnavailable ? 'DATE_UNAVAILABLE' : 'CONFIRMED'],
      )
      if (dateUnavailable) {
        await client.query('COMMIT')
        return 'DATE_UNAVAILABLE'
      }
      await releaseOverlappingHolds(client, input.bookingId)
    } else {
      await client.query(
        `UPDATE booking_payments
         SET status = 'NOT_RECEIVED', verified_at = clock_timestamp()
         WHERE id = $1`,
        [input.paymentId],
      )
      await client.query(
        `UPDATE bookings
         SET payment_status = CASE WHEN paid_amount > 0 THEN 'PARTIALLY_PAID' ELSE 'NOT_PAID' END,
             payment_amount = NULL, payment_method = NULL,
             payment_reference = '', proof_storage_key = NULL, proof_file_name = NULL
         WHERE id = $1`,
        [input.bookingId],
      )
    }
    await client.query('COMMIT')
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function recordCashPayment(input: {
  bookingId: string
  amount: number
}): Promise<false | 'DATE_UNAVAILABLE' | true> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const accommodationResult = await client.query<{ accommodation_id: string }>(
      'SELECT accommodation_id FROM bookings WHERE id = $1',
      [input.bookingId],
    )
    const accommodationId = accommodationResult.rows[0]?.accommodation_id
    if (!accommodationId) {
      await client.query('ROLLBACK')
      return false
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const result = await client.query(
      `SELECT status, payment_status, estimated_total, deposit_required, paid_amount,
              check_in_date, check_out_date, accommodation_id
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [input.bookingId],
    )
    const booking = result.rows[0]
    if (
      !booking ||
      inactiveForPaymentStatuses.includes(booking.status) ||
      booking.payment_status === 'PAID' ||
      booking.payment_status === 'PENDING_REVIEW'
    ) {
      await client.query('ROLLBACK')
      return false
    }
    const paidAmount = Number(booking.paid_amount)
    const remaining = Number(booking.estimated_total) - paidAmount
    if (
      !Number.isFinite(input.amount) ||
      input.amount < (paidAmount === 0 ? Number(booking.deposit_required) : 0.01) ||
      input.amount > remaining
    ) {
      await client.query('ROLLBACK')
      return false
    }
    const newPaidAmount = paidAmount + input.amount
    const overlapResult = await client.query(
      `SELECT other.id
       FROM bookings AS other, bookings AS me
       WHERE me.id = $1 AND other.id <> me.id AND other.status = 'CONFIRMED'
         AND ${rowsOverlapSql('other', 'me', '$2')}
       UNION ALL
       ${blockedForBookingSelect('me')}
       LIMIT 1`,
      [input.bookingId, wholeResortAccommodationIds],
    )
    const dateUnavailable = overlapResult.rowCount !== 0
    await client.query(
      `INSERT INTO booking_payments (
         id, booking_id, amount, method, source, status, verified_at
       ) VALUES ($1, $2, $3, 'CASH', 'ADMIN_CASH', 'RECEIVED', clock_timestamp())`,
      [randomUUID(), input.bookingId, input.amount],
    )
    await client.query(
      `UPDATE bookings
       SET paid_amount = $2,
           payment_status = CASE WHEN $2 >= estimated_total THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
           payment_method = 'CASH', payment_amount = $3,
           payment_reference = '', proof_storage_key = NULL, proof_file_name = NULL,
           status = $4
       WHERE id = $1`,
      [input.bookingId, newPaidAmount, input.amount, dateUnavailable ? 'DATE_UNAVAILABLE' : 'CONFIRMED'],
    )
    if (!dateUnavailable) await releaseOverlappingHolds(client, input.bookingId)
    await client.query('COMMIT')
    if (dateUnavailable) return 'DATE_UNAVAILABLE'
    return true
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function updateBookingReview(input: {
  id: string
  status: BookingStatus
}) {
  await ensureUserSchema()
  const values: unknown[] = [input.id]
  const updates: string[] = []
  values.push(input.status)
  updates.push(`status = $${values.length}`)
  if (updates.length === 0) return false

  const result = await getPool().query(
    `UPDATE bookings SET ${updates.join(', ')} WHERE id = $1 RETURNING id`,
    values,
  )
  return result.rowCount === 1
}

export async function createCustomer(input: {
  fullName: string
  email: string
  username: string
  passwordHash: string
}) {
  await ensureUserSchema()
  const result = await getPool().query<UserRecord>(
    `INSERT INTO users (id, full_name, email, username, password_hash, role)
     VALUES ($1, $2, $3, $4, $5, 'CUSTOMER')
     RETURNING id, full_name, email, username, password_hash, role`,
    [randomUUID(), input.fullName, input.email, input.username, input.passwordHash],
  )
  return result.rows[0]
}

export async function findUserByLogin(login: string, isEmail: boolean) {
  await ensureUserSchema()
  const result = await getPool().query<UserRecord>(
    `SELECT id, full_name, email, username, password_hash, role
     FROM users
     WHERE ${isEmail ? 'email' : 'username'} = $1
     LIMIT 1`,
    [login],
  )
  return result.rows[0] ?? null
}

export async function findUserById(id: string) {
  await ensureUserSchema()
  const result = await getPool().query<UserRecord>(
    `SELECT id, full_name, email, username, password_hash, role
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [id],
  )
  return result.rows[0] ?? null
}

export async function createOrUpdateAdmin(input: {
  fullName: string
  username: string
  passwordHash: string
}) {
  await ensureUserSchema()
  const result = await getPool().query<UserRecord>(
    `INSERT INTO users (id, full_name, username, password_hash, role)
     VALUES ($1, $2, $3, $4, 'ADMIN')
     ON CONFLICT (username) DO UPDATE
     SET full_name = EXCLUDED.full_name,
         email = NULL,
         password_hash = EXCLUDED.password_hash,
         role = 'ADMIN'
     RETURNING id, full_name, email, username, password_hash, role`,
    [randomUUID(), input.fullName, input.username, input.passwordHash],
  )
  return result.rows[0]
}

/** Whether the admin has closed any of these accommodations (or the whole resort) on these dates. */
export async function isStayBlocked(accommodationIds: string[], checkInDate: string, checkOutDate: string) {
  await ensureUserSchema()
  const result = await getPool().query(
    `SELECT 1 FROM blocked_dates AS bd
     WHERE ${blockOverlapSql('bd', '$1::text[]', '$2::date', '$3::date')} LIMIT 1`,
    [accommodationIds, checkInDate, checkOutDate],
  )
  return Boolean(result.rowCount)
}

export interface BlockedDateRecord {
  id: string
  accommodation_ids: string[]
  start_date: string
  end_date: string
  reason: string
  created_at: Date
}

/** Blocks that haven't ended yet, soonest first. */
export async function listBlockedDates() {
  await ensureUserSchema()
  const result = await getPool().query<BlockedDateRecord>(
    `SELECT id, accommodation_ids, start_date::text, end_date::text, reason, created_at
     FROM blocked_dates
     WHERE end_date > (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date
     ORDER BY start_date, created_at`,
  )
  return result.rows
}

/**
 * Closes dates for maintenance or private use. Confirmed bookings already on those dates are
 * not cancelled; their references are returned so the admin can reschedule them.
 */
export async function createBlockedDate(input: {
  id: string
  accommodationIds: string[]
  startDate: string
  endDate: string
  reason: string
  createdBy: string
}) {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    await client.query(
      `INSERT INTO blocked_dates (id, accommodation_ids, start_date, end_date, reason, created_by)
       VALUES ($1, $2::text[], $3::date, $4::date, $5, $6)`,
      [input.id, input.accommodationIds, input.startDate, input.endDate, input.reason, input.createdBy],
    )
    const conflicts = await client.query<{ reference_number: string }>(
      `SELECT b.reference_number FROM bookings AS b, blocked_dates AS bd
       WHERE bd.id = $1 AND b.status = 'CONFIRMED'
         AND ${blockOverlapSql('bd', 'b.accommodation_ids', 'b.check_in_date', 'b.check_out_date')}
       ORDER BY b.check_in_date`,
      [input.id],
    )
    await client.query('COMMIT')
    return conflicts.rows.map((row) => row.reference_number)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function deleteBlockedDate(id: string) {
  await ensureUserSchema()
  const result = await getPool().query('DELETE FROM blocked_dates WHERE id = $1', [id])
  return result.rowCount === 1
}

export type RescheduleResult =
  | { ok: true, checkInDate: string, checkOutDate: string }
  | { ok: false, reason: 'NOT_FOUND' | 'NOT_CONFIRMED' | 'UNCHANGED' | 'DATE_TAKEN' }

/**
 * Moves a confirmed booking to a new check-in date, keeping its length of stay, reference
 * number, price, and payment history. Refused if the new dates conflict with another
 * confirmed booking or blocked dates. Overlapping walk-in vouchers are released (first come,
 * first served), exactly as when a booking is confirmed.
 */
export async function rescheduleBooking(bookingId: string, newCheckInDate: string): Promise<RescheduleResult> {
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('booking_confirmation', 0))")
    const current = await client.query<{ status: string, check_in_date: string }>(
      'SELECT status, check_in_date::text FROM bookings WHERE id = $1 FOR UPDATE',
      [bookingId],
    )
    const booking = current.rows[0]
    if (!booking) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'NOT_FOUND' }
    }
    if (booking.status !== 'CONFIRMED') {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'NOT_CONFIRMED' }
    }
    if (booking.check_in_date === newCheckInDate) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'UNCHANGED' }
    }
    const moved = await client.query<{ check_in_date: string, check_out_date: string }>(
      `UPDATE bookings
       SET check_out_date = $2::date + (check_out_date - check_in_date), check_in_date = $2::date
       WHERE id = $1
       RETURNING check_in_date::text, check_out_date::text`,
      [bookingId, newCheckInDate],
    )
    const taken = await client.query(
      `SELECT other.id
       FROM bookings AS other, bookings AS me
       WHERE me.id = $1 AND other.id <> me.id AND other.status = 'CONFIRMED'
         AND ${rowsOverlapSql('other', 'me', '$2')}
       UNION ALL
       ${blockedForBookingSelect('me')}
       LIMIT 1`,
      [bookingId, wholeResortAccommodationIds],
    )
    if (taken.rowCount) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'DATE_TAKEN' }
    }
    await releaseOverlappingHolds(client, bookingId)
    await client.query('COMMIT')
    return { ok: true, checkInDate: moved.rows[0].check_in_date, checkOutDate: moved.rows[0].check_out_date }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export interface AdminUserRecord {
  id: string
  full_name: string
  username: string
  email: string | null
  role: 'ADMIN' | 'CUSTOMER'
  created_at: Date
}

export interface UserBookingRecord {
  id: string
  user_id: string
  reference_number: string
  hold_reference_number: string | null
  accommodation_name: string
  tour_type: TourType
  check_in_date: string
  check_out_date: string
  base_resort_price: string
  paid_amount: string
  status: BookingStatus
  payment_status: PaymentStatus
  payment_tier: PaymentTier | null
  expires_at: Date | null
  created_at: Date
}

/** Every account plus every booking linked to an account, for the admin Users tab. */
export async function listUsersWithBookings() {
  await ensureUserSchema()
  const [users, bookings] = await Promise.all([
    getPool().query<AdminUserRecord>(
      'SELECT id::text, full_name, username, email, role, created_at FROM users ORDER BY created_at DESC',
    ),
    getPool().query<UserBookingRecord>(
      `SELECT id, user_id::text, reference_number, hold_reference_number, accommodation_name, tour_type,
              check_in_date::text, check_out_date::text, base_resort_price, paid_amount, status,
              payment_status, payment_tier, expires_at, created_at
       FROM bookings WHERE user_id IS NOT NULL ORDER BY created_at DESC`,
    ),
  ])
  return { users: users.rows, bookings: bookings.rows }
}

export type DeleteUserResult =
  | { ok: true, purgedBookings: number, keptBookings: number, proofStorageKeys: string[] }
  | { ok: false, reason: 'NOT_FOUND' | 'SELF' | 'LAST_ADMIN' | 'ADMIN_PURGE' }

/**
 * Removes an account. By default its bookings and payments are kept (user_id becomes NULL
 * and the customer's name/email stay on each booking). With purgeBookings, the account's
 * bookings and their payments are deleted too (for test accounts). Admins can't remove
 * themselves or the last admin, and admin accounts can't be purged because walk-in cash
 * bookings are recorded under the admin who logged them.
 */
export async function deleteUserAccount(input: { userId: string, requesterId: string, purgeBookings: boolean }): Promise<DeleteUserResult> {
  if (input.userId === input.requesterId) return { ok: false, reason: 'SELF' }
  await ensureUserSchema()
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    // Serializes admin removals so two admins can't remove each other at the same time.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('user_admin_change', 0))")
    const target = await client.query<{ role: string }>('SELECT role FROM users WHERE id = $1 FOR UPDATE', [input.userId])
    const role = target.rows[0]?.role
    if (!role) {
      await client.query('ROLLBACK')
      return { ok: false, reason: 'NOT_FOUND' }
    }
    if (role === 'ADMIN') {
      if (input.purgeBookings) {
        await client.query('ROLLBACK')
        return { ok: false, reason: 'ADMIN_PURGE' }
      }
      const admins = await client.query<{ count: string }>("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN'")
      if (Number(admins.rows[0]?.count ?? 0) <= 1) {
        await client.query('ROLLBACK')
        return { ok: false, reason: 'LAST_ADMIN' }
      }
    }
    let purgedBookings = 0
    let keptBookings = 0
    let proofStorageKeys: string[] = []
    if (input.purgeBookings) {
      const proofs = await client.query<{ key: string }>(
        `SELECT b.proof_storage_key AS key FROM bookings b WHERE b.user_id = $1 AND b.proof_storage_key IS NOT NULL
         UNION
         SELECT p.proof_storage_key FROM booking_payments p JOIN bookings b ON b.id = p.booking_id
         WHERE b.user_id = $1 AND p.proof_storage_key IS NOT NULL`,
        [input.userId],
      )
      proofStorageKeys = proofs.rows.map((row) => row.key)
      // booking_payments rows go with their bookings (ON DELETE CASCADE).
      const purged = await client.query('DELETE FROM bookings WHERE user_id = $1', [input.userId])
      purgedBookings = purged.rowCount ?? 0
    } else {
      const kept = await client.query(
        `UPDATE bookings AS b
         SET customer_name = COALESCE(NULLIF(b.customer_name, ''), u.full_name),
             customer_email = COALESCE(NULLIF(b.customer_email, ''), u.email, '')
         FROM users AS u
         WHERE u.id = b.user_id AND b.user_id = $1`,
        [input.userId],
      )
      keptBookings = kept.rowCount ?? 0
    }
    await client.query('DELETE FROM users WHERE id = $1', [input.userId])
    await client.query('COMMIT')
    return { ok: true, purgedBookings, keptBookings, proofStorageKeys }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function closeDatabase() {
  if (pool) {
    await pool.end()
    pool = undefined
    schemaPromise = undefined
  }
}
