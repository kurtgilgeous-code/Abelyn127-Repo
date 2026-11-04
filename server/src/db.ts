import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { Pool } from 'pg'

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

export interface UserRecord {
  id: string
  full_name: string
  email: string | null
  username: string
  password_hash: string
  role: 'ADMIN' | 'CUSTOMER'
}

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DATE_UNAVAILABLE'
export type PaymentStatus = 'UNPAID' | 'PENDING_REVIEW' | 'PARTIALLY_PAID' | 'PAID' | 'NOT_PAID' | 'VOID'
export type PaymentMethod = 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER' | 'CASH'
export type TourType = 'OVERNIGHT' | 'DAY_TOUR' | 'NIGHT_TOUR'

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
  user_id: string
  customer_name: string
  customer_email: string
  accommodation_id: string
  accommodation_name: string
  tour_type: TourType
  check_in_date: string
  check_out_date: string
  adults: number
  seniors_pwd: number
  children: number
  guest_count: number
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
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(12, 2);
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
        ALTER TABLE bookings ADD COLUMN IF NOT EXISTS tour_type TEXT NOT NULL DEFAULT 'OVERNIGHT';
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_tour_type_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_tour_type_check
          CHECK (tour_type IN ('OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR'));
        ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
        ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
          CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'DATE_UNAVAILABLE'));
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
  SELECT b.id, b.user_id, u.full_name AS customer_name,
         COALESCE(u.email, '') AS customer_email,
         b.accommodation_id, b.accommodation_name,
         b.tour_type,
         b.check_in_date::text, b.check_out_date::text,
         b.adults, b.seniors_pwd, b.children, b.guest_count,
         b.estimated_total, b.deposit_required, b.payment_amount, b.paid_amount, b.status, b.payment_status,
         b.payment_method, b.payment_reference, b.proof_storage_key,
         b.proof_file_name, b.created_at
  FROM bookings b
  JOIN users u ON u.id = b.user_id
`

export async function createBooking(input: {
  id: string
  userId: string
  accommodationId: string
  accommodationName: string
  tourType: TourType
  checkInDate: string
  checkOutDate: string
  adults: number
  seniorsPwd: number
  children: number
  guestCount: number
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
       id, user_id, accommodation_id, accommodation_name, check_in_date,
       tour_type, check_out_date, adults, seniors_pwd, children, guest_count,
       estimated_total, deposit_required, payment_status, payment_amount,
       payment_method, payment_reference, proof_storage_key, proof_file_name
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'PENDING_REVIEW', $14, $15, $16, $17, $18)`,
    [
      input.id, input.userId, input.accommodationId, input.accommodationName,
      input.checkInDate, input.tourType, input.checkOutDate, input.adults, input.seniorsPwd,
      input.children, input.guestCount, input.estimatedTotal, input.depositRequired,
      input.paymentAmount, input.paymentMethod, input.paymentReference,
      input.proofStorageKey, input.proofFileName,
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
    if (!booking || ['CANCELLED', 'DATE_UNAVAILABLE'].includes(booking.status) || booking.payment_status === 'PENDING_REVIEW' || booking.payment_status === 'PAID') {
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
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [accommodationId])
    const result = await client.query(
      `SELECT p.amount, b.estimated_total, b.paid_amount, b.accommodation_id,
              b.check_in_date, b.check_out_date
       FROM booking_payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.id = $1 AND p.booking_id = $2
         AND p.status = 'PENDING_REVIEW'
       AND b.status NOT IN ('CANCELLED', 'DATE_UNAVAILABLE')
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
        `SELECT id
         FROM bookings
         WHERE accommodation_id = $1
           AND id <> $2
           AND status = 'CONFIRMED'
           AND check_in_date < $4
           AND check_out_date > $3
         LIMIT 1`,
        [payment.accommodation_id, input.bookingId, payment.check_in_date, payment.check_out_date],
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
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [accommodationId])
    const result = await client.query(
      `SELECT status, payment_status, estimated_total, deposit_required, paid_amount,
              check_in_date, check_out_date, accommodation_id
       FROM bookings WHERE id = $1 FOR UPDATE`,
      [input.bookingId],
    )
    const booking = result.rows[0]
    if (
      !booking ||
      ['CANCELLED', 'DATE_UNAVAILABLE'].includes(booking.status) ||
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
      `SELECT id
       FROM bookings
       WHERE accommodation_id = $1
         AND id <> $2
         AND status = 'CONFIRMED'
         AND check_in_date < $4
         AND check_out_date > $3
       LIMIT 1`,
      [booking.accommodation_id, input.bookingId, booking.check_in_date, booking.check_out_date],
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

export async function closeDatabase() {
  if (pool) {
    await pool.end()
    pool = undefined
    schemaPromise = undefined
  }
}
