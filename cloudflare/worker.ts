import {
  GERAINT_ATTEMPT_TIMEOUT_MS,
  GERAINT_GENERATION_CONFIG,
  GERAINT_SYSTEM_INSTRUCTION,
  GERAINT_UNAVAILABLE_MESSAGE,
  geraintModelChain,
  parseChatMessages,
  toGeminiContents,
} from '../server/src/geraint.js'
import { buildAdminUsers, manilaToday, validDateInput, type UserBookingRow, type UserRow as AdminUserRow } from '../server/src/userStats.js'

interface Env {
  DB: D1Database
  PAYMENT_PROOFS: R2Bucket
  ASSETS: { fetch(request: Request): Promise<Response> }
  JWT_SECRET?: string
  HITPAY_API_KEY?: string
  HITPAY_WEBHOOK_SALT?: string
  HITPAY_MODE?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  APP_ORIGIN?: string
}

type UserRole = 'ADMIN' | 'CUSTOMER'
type TourType = 'OVERNIGHT' | 'DAY_TOUR' | 'NIGHT_TOUR'
type PaymentMethod = 'GCASH' | 'MAYA' | 'BANK_TRANSFER' | 'OTHER' | 'CASH'
type BookingStatus =
  | 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'DATE_UNAVAILABLE'
  | 'PENDING_HOLD' | 'EXPIRED' | 'CANCELLED_BY_GCASH_PRIORITY'
type PaymentStatus = 'UNPAID' | 'PENDING_REVIEW' | 'PARTIALLY_PAID' | 'PAID' | 'PAID_CASH' | 'NOT_PAID' | 'VOID'
type PaymentTier = 'ONLINE_GCASH_RESERVATION' | 'WALKIN_CASH_NO_RESERVATION' | 'PENDING_CASH_INQUIRY'

interface AuthUser {
  id: string
  email: string
  username: string
  name: string
  role: UserRole
}

interface UserRow {
  id: string
  full_name: string
  email: string | null
  username: string
  password_hash: string
  role: UserRole
}

interface BookingJoinedRow {
  id: string
  user_id: string
  customer_name: string
  customer_email: string
  accommodation_id: string
  accommodation_ids: string | null
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
  reference_number: string
  payment_tier: PaymentTier | null
  base_resort_price: number
  base_deposit_amount: number
  gateway_fee_amount: number
  total_online_paid: number
  cash_balance_due: number
  gateway_payment_id: string | null
  gateway_checkout_id: string | null
  payment_amount: number | null
  paid_amount: number
  status: BookingStatus
  payment_status: PaymentStatus
  payment_method: PaymentMethod | null
  payment_reference: string
  proof_storage_key: string | null
  proof_file_name: string | null
  created_at: string
  expires_at: string | null
  priority_rank: number | null
  hold_reference_number: string | null
  joined_payment_id: string | null
  joined_payment_amount: number | null
  joined_payment_method: PaymentMethod | null
  joined_payment_reference: string | null
  joined_payer_account: string | null
  joined_payment_source: 'CUSTOMER' | 'ADMIN_CASH' | null
  joined_payment_status: 'PENDING_REVIEW' | 'RECEIVED' | 'NOT_RECEIVED' | null
  joined_payment_proof_key: string | null
  joined_payment_proof_name: string | null
  joined_payment_created_at: string | null
  joined_payment_verified_at: string | null
}

const paymentMethods: PaymentMethod[] = ['GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER']
const bookingStatuses: BookingStatus[] = ['PENDING', 'CANCELLED']
const tourTypes: TourType[] = ['OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR']

/** A walk-in voucher stays valid through the end of its check-in date, Philippine time. */
const voucherExpiresAt = (checkInDate: string) => new Date(`${checkInDate}T23:59:59.999+08:00`)
/** An unpaid GCash checkout is treated as abandoned after this many hours. */
const ABANDONED_CHECKOUT_HOURS = 2
/** Active (unexpired) holds one account may have at once, so no one can tie up every date. */
const MAX_ACTIVE_HOLDS_PER_USER = 2
/** Statuses in which a booking can no longer take payments through the normal payment flows. */
const inactiveForPaymentSql = ['CANCELLED', 'DATE_UNAVAILABLE', 'PENDING_HOLD', 'EXPIRED', 'CANCELLED_BY_GCASH_PRIORITY']
  .map((status) => `'${status}'`).join(', ')
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const rates: Record<string, {
  name: string
  /** Day Tour / Night Tour rate (one session). */
  baseRate: number
  /** Overnight (22 hours) rate; also charged per day for any booking of 2 or more days. */
  overnightRate: number
  capacity: number
  /** Overnight maximum pax, when it differs from the Day/Night Tour maximum. */
  overnightCapacity?: number
  entranceFeeForAll: boolean
  exclusiveWholeResort?: boolean
}> = {
  'abelyns-cabin-glass': {
    name: "Abelyn's Cabin Glass",
    baseRate: 6000,
    overnightRate: 7500,
    capacity: 8,
    entranceFeeForAll: false,
    exclusiveWholeResort: true,
  },
  'bahay-hapag': { name: 'Bahay Hapag', baseRate: 2500, overnightRate: 3500, capacity: 4, entranceFeeForAll: false },
  'balai-delnor': {
    name: 'Balai Delnor',
    baseRate: 6500,
    overnightRate: 8000,
    capacity: 12,
    entranceFeeForAll: false,
    exclusiveWholeResort: true,
  },
  gazebo: { name: 'Gazebo', baseRate: 1000, overnightRate: 2000, capacity: 6, entranceFeeForAll: true },
  'balay-buknoy': { name: 'Balay Buknoy', baseRate: 4000, overnightRate: 5000, capacity: 8, entranceFeeForAll: false },
  'abelyns-mini-event-area': { name: "Abelyn's Mini Event Area", baseRate: 2500, overnightRate: 3500, capacity: 20, overnightCapacity: 10, entranceFeeForAll: false },
  'balai-andeng': { name: 'Balai Andeng', baseRate: 1200, overnightRate: 1500, capacity: 2, entranceFeeForAll: false },
  'calesa-tables': { name: 'Calesa Tables', baseRate: 500, overnightRate: 500, capacity: 6, entranceFeeForAll: true },
  'kubo-ni-gerrant': { name: 'Kubo ni Gerrant', baseRate: 1000, overnightRate: 1500, capacity: 12, entranceFeeForAll: true },
}
const wholeResortAccommodationIds = Object.entries(rates)
  .filter(([, accommodation]) => accommodation.exclusiveWholeResort)
  .map(([id]) => id)
const wholeResortAccommodationSql = wholeResortAccommodationIds.map((id) => `'${id}'`).join(', ')
const accommodationOrder = Object.keys(rates)

/**
 * Reads a booking request's accommodations: `accommodationIds` (one booking can combine
 * several, e.g. Bahay Hapag + Balai Delnor) or the older single `accommodationId`.
 * Returns the IDs de-duplicated in listing order, or null if any is unknown.
 */
function parseAccommodationIds(body: unknown): string[] | null {
  if (!isRecord(body)) return null
  const raw = Array.isArray(body.accommodationIds)
    ? body.accommodationIds
    : typeof body.accommodationId === 'string' ? [body.accommodationId] : null
  if (!raw || raw.length === 0 || raw.length > accommodationOrder.length) return null
  if (!raw.every((id): id is string => typeof id === 'string' && Object.prototype.hasOwnProperty.call(rates, id))) return null
  return [...new Set(raw)].sort((a, b) => accommodationOrder.indexOf(a) - accommodationOrder.indexOf(b))
}

/**
 * Two posters set the prices (mirrors server/src/pricing.ts):
 * - Day Tour and Night Tour (one day): the Day/Night room rate, with that tour's entrance
 *   included up to the rooms' pax (Abelyn's Cabin Glass: ₱6,000 covers 8 guests); extra heads
 *   pay entrance (Day ₱150 / ₱120, Night ₱250 / ₱150).
 * - Overnight (22 hours), also used for every booking of 2 or more days: the overnight rate per
 *   day (Abelyn's Cabin Glass for 3 days is 3 × ₱7,500), entrance included up to the pax.
 * Where pax are included, Gazebo, Calesa Tables, and Kubo ni Gerrant still charge every guest.
 */
function usesOvernightRates(tourType: unknown, days: number) {
  return tourType === 'OVERNIGHT' || days > 1
}

/**
 * Guests above the rooms' pax are allowed: they pay the entrance fee (both posters). One booking
 * is capped at this many guests so a typo or abuse can't create an absurd booking.
 */
const BOOKING_MAX_GUESTS = 100

/** A guest-facing message if the request has more guests than one booking allows. */
function guestLimitMessage(body: unknown) {
  const guests = (body as { guests?: Record<string, unknown> } | null)?.guests
  if (typeof guests !== 'object' || guests === null) return null
  const count = ['adults', 'seniorsPwd', 'children']
    .reduce((sum, key) => sum + (Number.isInteger(guests[key]) ? Number(guests[key]) : 0), 0)
  return count > BOOKING_MAX_GUESTS
    ? `One booking can have up to ${BOOKING_MAX_GUESTS} guests. For a bigger group, please contact the resort.`
    : null
}

function parseStoredAccommodationIds(stored: string | null, fallback: string) {
  try {
    const ids: unknown = stored ? JSON.parse(stored) : null
    if (Array.isArray(ids) && ids.length && ids.every((id) => typeof id === 'string')) return ids as string[]
  } catch {
    // fall through to the single stored accommodation
  }
  return [fallback]
}

/** A booking row's accommodation IDs as a JSON array (rows from before multi-select hold one). */
function accommodationIdsSql(alias: string) {
  return `COALESCE(NULLIF(${alias}.accommodation_ids, '[]'), json_array(${alias}.accommodation_id))`
}

/**
 * SQL condition: two JSON lists of accommodation IDs compete for the same space (they share
 * an accommodation, or either includes an exclusive whole-resort accommodation).
 */
function sharesSpaceSql(aIds: string, bIds: string) {
  return `EXISTS (
      SELECT 1 FROM json_each(${aIds}) AS space_a, json_each(${bIds}) AS space_b
      WHERE space_a.value = space_b.value
        OR space_a.value IN (${wholeResortAccommodationSql})
        OR space_b.value IN (${wholeResortAccommodationSql})
    )`
}

/** SQL condition on `bookings`: competes for the space in a bound JSON list of accommodation IDs (one `?`). */
const requestedSpaceSql = sharesSpaceSql(accommodationIdsSql('bookings'), '?')

/**
 * SQL condition: the admin closed these dates (maintenance / private use). A block with no
 * accommodations ('[]') closes the whole resort; otherwise only the listed ones. Placeholders,
 * if used, appear in this order: check-out, check-in, accommodation IDs (JSON).
 */
function blockMatchesSql(accommodationIds: string, checkIn: string, checkOut: string) {
  return `EXISTS (
      SELECT 1 FROM blocked_dates AS bd
      WHERE bd.start_date < ${checkOut} AND bd.end_date > ${checkIn}
        AND (bd.accommodation_ids = '[]' OR EXISTS (
          SELECT 1 FROM json_each(bd.accommodation_ids) AS blk_a, json_each(${accommodationIds}) AS blk_b
          WHERE blk_a.value = blk_b.value
        ))
    )`
}
/** Requested stay is blocked: binds check-out, check-in, accommodation IDs JSON. */
const requestedBlockSql = blockMatchesSql('?', '?', '?')
/** The `bookings` row being written falls on blocked dates (no binds). */
const bookingRowBlockSql = blockMatchesSql(accommodationIdsSql('bookings'), 'bookings.check_in_date', 'bookings.check_out_date')

/** Open = no confirmed booking competes for the space and the resort hasn't closed the dates. */
async function stayIsOpen(env: Env, accommodationIdsJson: string, checkInDate: string, checkOutDate: string) {
  const row = await env.DB.prepare(`
    SELECT NOT EXISTS (
      SELECT 1 FROM bookings
      WHERE status = 'CONFIRMED' AND check_in_date < ? AND check_out_date > ?
        AND ${requestedSpaceSql}
    ) AND NOT ${requestedBlockSql} AS open
  `).bind(checkOutDate, checkInDate, accommodationIdsJson, checkOutDate, checkInDate, accommodationIdsJson)
    .first<{ open: number }>()
  return Boolean(row?.open)
}

const entranceRates: Record<TourType, { adults: number; seniorsPwd: number; children: number }> = {
  DAY_TOUR: { adults: 150, seniorsPwd: 120, children: 120 },
  NIGHT_TOUR: { adults: 250, seniorsPwd: 150, children: 150 },
  OVERNIGHT: { adults: 250, seniorsPwd: 150, children: 150 },
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function readJson(request: Request) {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 10 * 1024) return { body: null, tooLarge: true }
  const text = await request.text()
  if (encoder.encode(text).length > 10 * 1024) return { body: null, tooLarge: true }
  try {
    return { body: JSON.parse(text) as unknown, tooLarge: false }
  } catch {
    return { body: null, tooLarge: false }
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function configurationError(env: Env) {
  if (!env.JWT_SECRET || encoder.encode(env.JWT_SECRET).length < 32) {
    return 'JWT_SECRET is missing or too short. Configure a secret with at least 32 characters.'
  }
  return null
}

function publicUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email ?? '',
    username: row.username,
    name: row.full_name,
    role: row.role,
  }
}

async function passwordHash(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 310_000 },
    key,
    256,
  )
  return `pbkdf2$310000$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(derived))}`
}

async function verifyPassword(password: string, stored: string) {
  const [algorithm, iterationsValue, saltValue, expectedValue] = stored.split('$')
  const iterations = Number(iterationsValue)
  if (algorithm !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 100_000 ||
      iterations > 1_000_000 || !saltValue || !expectedValue) return false
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const actual = new Uint8Array(await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: base64UrlToBytes(saltValue), iterations },
      key,
      256,
    ))
    const expected = base64UrlToBytes(expectedValue)
    if (actual.length !== expected.length) return false
    let difference = 0
    for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ expected[index]
    return difference === 0
  } catch {
    return false
  }
}

async function signToken(user: AuthUser, secret: string) {
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const issuedAt = Math.floor(Date.now() / 1000)
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({
    sub: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
    iat: issuedAt,
    exp: issuedAt + 8 * 60 * 60,
  })))
  const input = `${header}.${payload}`
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(input))
  return `${input}.${bytesToBase64Url(new Uint8Array(signature))}`
}

async function authenticatedUser(request: Request, env: Env): Promise<AuthUser | null> {
  if (!env.JWT_SECRET) return null
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let payload: unknown
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(env.JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify('HMAC', key, base64UrlToBytes(parts[2]), encoder.encode(`${parts[0]}.${parts[1]}`))
    if (!valid) return null
    payload = JSON.parse(decoder.decode(base64UrlToBytes(parts[1])))
  } catch {
    return null
  }
  if (!isRecord(payload) || typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null

  const user = await env.DB.prepare(`
    SELECT id, full_name, email, username, password_hash, role
    FROM users WHERE id = ? LIMIT 1
  `).bind(payload.sub).first<UserRow>()
  return user ? publicUser(user) : null
}

/** Rate-limit bucket for this client IP (HMAC'd, so raw IPs are never stored). */
async function rateLimitKey(env: Env, request: Request, keyName: string) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.JWT_SECRET ?? ''),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(`${keyName}:${ip}`)))
  return bytesToBase64Url(digest)
}

/** Read-only check: has this client already used up its attempts in the current window? */
async function rateLimitExhausted(env: Env, request: Request, keyName: string, windowMs: number, maximum: number) {
  const row = await env.DB.prepare('SELECT window_started_at, attempts FROM auth_rate_limits WHERE key = ?')
    .bind(await rateLimitKey(env, request, keyName)).first<{ window_started_at: number, attempts: number }>()
  return Boolean(row && row.window_started_at > Date.now() - windowMs && Number(row.attempts) >= maximum)
}

async function limited(env: Env, request: Request, keyName: string, windowMs: number, maximum: number) {
  const key = await rateLimitKey(env, request, keyName)
  const now = Date.now()
  const cutoff = now - windowMs
  await env.DB.prepare('DELETE FROM auth_rate_limits WHERE window_started_at < ?')
    .bind(now - 86_400_000).run()
  const result = await env.DB.prepare(`
    INSERT INTO auth_rate_limits (key, window_started_at, attempts)
    VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
      window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END
    RETURNING attempts
  `).bind(key, now, cutoff, cutoff).first<{ attempts: number }>()
  const attempts = Number(result?.attempts ?? maximum + 1)
  return attempts <= maximum
}

/**
 * Price of one booking that may combine several accommodations. Accommodation rates add up;
 * entrance fees are charged once per guest, after the combined included capacity of the
 * selected accommodations (those that charge every guest include no one).
 */
type GuestCounts = { adults: number; seniorsPwd: number; children: number }

/**
 * Reads the optional `extraGuests` of a booking request: the guests, by type, that the customer
 * added beyond the room's pax. Returns undefined when absent, null when malformed.
 */
function parseExtraGuests(body: unknown): GuestCounts | undefined | null {
  if (!isRecord(body) || body.extraGuests === undefined || body.extraGuests === null) return undefined
  if (!isRecord(body.extraGuests)) return null
  const counts = { adults: body.extraGuests.adults, seniorsPwd: body.extraGuests.seniorsPwd, children: body.extraGuests.children }
  return Object.values(counts).every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)
    ? counts as GuestCounts
    : null
}

/** A booking row's stored `extra_guests` JSON, or null (older bookings, or every guest pays). */
function parseStoredExtraGuests(stored: string | null | undefined): GuestCounts | null {
  if (!stored) return null
  try {
    return parseExtraGuests({ extraGuests: JSON.parse(stored) }) ?? null
  } catch {
    return null
  }
}

/**
 * Where the rooms include entrance for their pax, the customer fills the pax with their main
 * guests first and declares the rest as `extras` (by type), who pay entrance. Without a
 * declaration, the pax cover children, then seniors/PWD, then adults, so extra heads are charged
 * the adult rate first. Mirrors server/src/pricing.ts.
 */
function calculatePricing(
  accommodationIds: string[],
  tourType: TourType,
  guests: GuestCounts,
  days: number,
  extras?: GuestCounts,
) {
  const selected = accommodationIds.map((id) => rates[id])
  if (selected.length === 0 || selected.some((item) => !item)) return null
  const overnight = usesOvernightRates(tourType, days)
  const accommodation = {
    baseRate: selected.reduce((sum, item) => sum + (overnight ? item.overnightRate : item.baseRate), 0),
    capacity: selected.reduce((sum, item) => sum + (item.entranceFeeForAll ? 0 : overnight ? item.overnightCapacity ?? item.capacity : item.capacity), 0),
    // Entrance is included up to the pax, except where an accommodation charges every guest.
    entranceFeeForAll: selected.every((item) => item.entranceFeeForAll),
    name: selected.map((item) => item.name).join(' + '),
  }
  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  if (guestCount > BOOKING_MAX_GUESTS) return null
  let chargeable = { ...guests }
  if (!accommodation.entranceFeeForAll) {
    const extraCount = Math.max(0, guestCount - accommodation.capacity)
    if (extras) {
      // Main guests fill the pax first; the declared extras must be exactly the rest.
      const declared = extras.adults + extras.seniorsPwd + extras.children
      if (
        declared !== extraCount ||
        extras.adults > guests.adults || extras.seniorsPwd > guests.seniorsPwd || extras.children > guests.children
      ) return null
      chargeable = { ...extras }
    } else {
      let remainingCapacity = Math.min(guestCount, accommodation.capacity)
      const includedChildren = Math.min(chargeable.children, remainingCapacity)
      chargeable.children -= includedChildren
      remainingCapacity -= includedChildren
      const includedSeniors = Math.min(chargeable.seniorsPwd, remainingCapacity)
      chargeable.seniorsPwd -= includedSeniors
      remainingCapacity -= includedSeniors
      chargeable.adults -= Math.min(chargeable.adults, remainingCapacity)
    }
  }
  const entranceRate = entranceRates[overnight ? 'OVERNIGHT' : tourType]
  const entranceTotal = chargeable.adults * entranceRate.adults +
    chargeable.seniorsPwd * entranceRate.seniorsPwd +
    chargeable.children * entranceRate.children
  const total = (accommodation.baseRate + entranceTotal) * days
  return {
    total,
    deposit: total * 0.5,
    accommodationName: accommodation.name,
    /** Guests beyond the rooms' pax, by type (null when every guest pays entrance). */
    extraGuests: accommodation.entranceFeeForAll ? null : chargeable,
  }
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
  const accommodationIds = parseAccommodationIds(body)
  const tourType = body.tourType
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
  // The display name is derived from the accommodations; a client-sent name is ignored.
  const pricing = calculatePricing(
    accommodationIds,
    tourType as TourType,
    { adults, seniorsPwd, children },
    days,
    extras,
  )
  if (!pricing) return null
  return {
    accommodationId: accommodationIds[0],
    accommodationIdsJson: JSON.stringify(accommodationIds),
    accommodationName: pricing.accommodationName,
    tourType: tourType as TourType,
    checkInDate,
    checkOutDate,
    adults,
    seniorsPwd,
    children,
    guestCount,
    extraGuestsJson: pricing.extraGuests ? JSON.stringify(pricing.extraGuests) : null,
    baseResortPrice: Math.round(pricing.total * 100) / 100,
    baseDepositAmount: Math.round(pricing.total * 50) / 100,
  }
}

function referenceNumber(prefix: 'GCASH' | 'CASH' | 'HOLD') {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }).replaceAll('-', '')
  const suffix = crypto.getRandomValues(new Uint16Array(1))[0] % 10_000
  return `TRP-${prefix}-${date}-${suffix.toString().padStart(4, '0')}`
}

function checkoutOrigin(request: Request, env: Env) {
  const configured = env.APP_ORIGIN?.split(',').map((origin) => origin.trim()).find(Boolean)
  return (configured || new URL(request.url).origin).replace(/\/+$/, '')
}

// Online fee added on top of the deposit. HitPay's published GCash rate is 2.3% + VAT;
// confirm the rate on your HitPay account before going live.
const ONLINE_FEE_RATE = 0.025

type HitpayConfig = { apiKey: string, apiBase: string }

function hitpayConfig(env: Env): HitpayConfig | null {
  const apiKey = env.HITPAY_API_KEY?.trim()
  const mode = env.HITPAY_MODE?.trim().toLowerCase()
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

async function createGcashCheckout(request: Request, env: Env, user: AuthUser) {
  const hitpay = hitpayConfig(env)
  if (!hitpay) {
    return json({ message: 'Online GCash checkout is not configured. Please contact the resort.' }, 503)
  }
  const parsed = await readJson(request)
  if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
  const booking = getBookingDetails(parsed.body)
  if (!booking) {
    return json({ message: guestLimitMessage(parsed.body) ?? 'Booking dates, accommodation, tour type, or guest details are invalid. Refresh the page and check the current rates.' }, 400)
  }
  if (!(await stayIsOpen(env, booking.accommodationIdsJson, booking.checkInDate, booking.checkOutDate))) {
    return json({ message: 'These dates are no longer available (already confirmed or closed by the resort). Please choose another date or accommodation.' }, 409)
  }

  const onlineCharge = Math.round((booking.baseDepositAmount / (1 - ONLINE_FEE_RATE)) * 100) / 100
  const gatewayFeeAmount = Math.round((onlineCharge - booking.baseDepositAmount) * 100) / 100
  const totalOnlinePaid = Math.round((booking.baseDepositAmount + gatewayFeeAmount) * 100) / 100
  const cashBalanceDue = Math.round((booking.baseResortPrice - booking.baseDepositAmount) * 100) / 100
  const bookingId = `TS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  let reference = ''
  let inserted = false
  for (let attempt = 0; attempt < 5; attempt += 1) {
    reference = referenceNumber('GCASH')
    try {
      await env.DB.prepare(`
        INSERT INTO bookings (
          id, user_id, customer_name, customer_email, reference_number, payment_tier,
          base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
          cash_balance_due, accommodation_id, accommodation_name, tour_type,
          check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
          estimated_total, deposit_required, payment_amount, paid_amount, status,
          payment_status, payment_method, payment_reference, priority_rank, accommodation_ids, extra_guests
        ) VALUES (
          ?, ?, ?, ?, ?, 'ONLINE_GCASH_RESERVATION',
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING',
          'UNPAID', 'GCASH', ?, 1, ?, ?
        )
      `).bind(
        bookingId, user.id, user.name, user.email, reference,
        booking.baseResortPrice, booking.baseDepositAmount, gatewayFeeAmount,
        totalOnlinePaid, cashBalanceDue, booking.accommodationId, booking.accommodationName,
        booking.tourType, booking.checkInDate, booking.checkOutDate, booking.adults,
        booking.seniorsPwd, booking.children, booking.guestCount, booking.baseResortPrice,
        booking.baseDepositAmount, totalOnlinePaid, reference, booking.accommodationIdsJson,
        booking.extraGuestsJson,
      ).run()
      inserted = true
      break
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('UNIQUE constraint failed')) || attempt === 4) throw error
    }
  }
  if (!inserted) return json({ message: 'Could not generate a unique booking reference. Please try again.' }, 503)

  const form = new URLSearchParams({
    amount: totalOnlinePaid.toFixed(2),
    currency: 'PHP',
    purpose: `50% resort deposit + online fee - ${booking.accommodationName}`.slice(0, 255),
    reference_number: reference,
    // HitPay appends ?reference=<payment request id>&status=<status> to this URL,
    // so the booking reference travels in the path instead of the query string.
    redirect_url: `${checkoutOrigin(request, env)}/booking/return/${encodeURIComponent(reference)}`,
    name: user.name.slice(0, 255),
    allow_repeated_payments: 'false',
    send_email: user.email ? 'true' : 'false',
  })
  form.append('payment_methods[]', 'gcash')
  if (user.email) form.set('email', user.email)

  let checkoutResponse: Response
  try {
    checkoutResponse = await fetch(`${hitpay.apiBase}/payment-requests`, {
      method: 'POST',
      headers: { ...hitpayHeaders(hitpay), 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(15_000),
      body: form,
    })
  } catch (error) {
    await env.DB.prepare(`
      UPDATE bookings SET status = 'CANCELLED', payment_status = 'NOT_PAID'
      WHERE reference_number = ? AND payment_status = 'UNPAID'
    `).bind(reference).run()
    console.error('HitPay payment request failed:', error)
    return json({ message: 'Could not start GCash checkout. Please try again or contact the resort.' }, 502)
  }

  let providerBody: unknown
  try {
    providerBody = await checkoutResponse.json()
  } catch {
    providerBody = null
  }
  if (!checkoutResponse.ok || !isRecord(providerBody) ||
      typeof providerBody.id !== 'string' || typeof providerBody.url !== 'string') {
    await env.DB.prepare(`
      UPDATE bookings SET status = 'CANCELLED', payment_status = 'NOT_PAID'
      WHERE reference_number = ? AND payment_status = 'UNPAID'
    `).bind(reference).run()
    console.error('HitPay rejected payment request creation:', checkoutResponse.status)
    return json({ message: 'Could not start GCash checkout. Please try again or contact the resort.' }, 502)
  }
  const saved = await env.DB.prepare(`
    UPDATE bookings SET gateway_checkout_id = ?
    WHERE reference_number = ? AND payment_tier = 'ONLINE_GCASH_RESERVATION'
      AND status = 'PENDING' AND gateway_checkout_id IS NULL
  `).bind(providerBody.id, reference).run()
  if (!saved.meta.changes) {
    return json({ message: 'This booking could not be prepared for checkout. Please try again.' }, 409)
  }
  return json({ bookingId, referenceNumber: reference, checkoutUrl: providerBody.url }, 201)
}

async function createWalkInCashBooking(request: Request, env: Env, user: AuthUser) {
  const parsed = await readJson(request)
  if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
  const body = parsed.body
  const details = getBookingDetails(body)
  if (!details || !isRecord(body)) {
    return json({ message: guestLimitMessage(body) ?? 'Enter valid walk-in dates, accommodation, tour type, and guests.' }, 400)
  }
  const customerName = typeof body.customerName === 'string' ? body.customerName.trim() : ''
  const customerEmail = typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  if (!customerName || customerName.length > 120 || details.checkInDate !== today) {
    return json({ message: 'Enter a guest name and a valid same-day check-in date.' }, 400)
  }
  if (customerEmail && (customerEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
    return json({ message: 'Enter a valid guest email address or leave it blank.' }, 400)
  }
  const bookingId = `TS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = referenceNumber('CASH')
    try {
      const results = await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO bookings (
            id, user_id, customer_name, customer_email, reference_number, payment_tier,
            base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
            cash_balance_due, accommodation_id, accommodation_name, tour_type,
            check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
            estimated_total, deposit_required, payment_amount, paid_amount, status,
            payment_status, payment_method, payment_reference, priority_rank, accommodation_ids, extra_guests
          )
          SELECT ?, ?, ?, ?, ?, 'WALKIN_CASH_NO_RESERVATION',
                 ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'CONFIRMED',
                 'PAID', 'CASH', ?, 1, ?, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM bookings
            WHERE status = 'CONFIRMED'
              AND check_in_date < ?
              AND check_out_date > ?
              AND ${requestedSpaceSql}
          )
          AND NOT ${requestedBlockSql}
        `).bind(
          // base_resort_price, cash_balance_due
          bookingId, user.id, customerName, customerEmail, reference,
          details.baseResortPrice, details.baseResortPrice, details.accommodationId,
          details.accommodationName, details.tourType, details.checkInDate, details.checkOutDate,
          details.adults, details.seniorsPwd, details.children, details.guestCount,
          // estimated_total, payment_amount, paid_amount, payment_reference, accommodation_ids
          details.baseResortPrice, details.baseResortPrice, details.baseResortPrice, reference,
          details.accommodationIdsJson, details.extraGuestsJson,
          // overlap check
          details.checkOutDate, details.checkInDate, details.accommodationIdsJson,
          // blocked-dates check
          details.checkOutDate, details.checkInDate, details.accommodationIdsJson,
        ),
        env.DB.prepare(`
          INSERT INTO booking_payments (id, booking_id, amount, method, reference, payer_account, source, status, verified_at)
          SELECT ?, ?, ?, 'CASH', ?, '', 'ADMIN_CASH', 'RECEIVED', ?
          WHERE changes() = 1
        `).bind(crypto.randomUUID(), bookingId, details.baseResortPrice, reference, new Date().toISOString()),
        releaseOverlappingHolds(env, bookingId),
      ])
      if (!results[0]?.meta.changes || !results[1]?.meta.changes) {
        return json({ message: 'Those dates are already reserved. Check availability and try another accommodation or date.' }, 409)
      }
      return json({ bookingId, referenceNumber: reference }, 201)
    } catch (error) {
      if (!(error instanceof Error && error.message.includes('UNIQUE constraint failed')) || attempt === 4) throw error
    }
  }
  return json({ message: 'Could not generate a unique walk-in reference. Please try again.' }, 503)
}

/**
 * SQL condition: rows `a` and `b` overlap in dates and compete for the same space (they
 * share an accommodation, or either includes an exclusive whole-resort accommodation).
 */
function rowsOverlapSql(a: string, b: string) {
  return `${a}.check_in_date < ${b}.check_out_date
    AND ${a}.check_out_date > ${b}.check_in_date
    AND ${sharesSpaceSql(accommodationIdsSql(a), accommodationIdsSql(b))}`
}

/**
 * First come, first served: dates belong to whichever booking is CONFIRMED first.
 * Added to every confirming batch (same transaction): once the booking is confirmed, every
 * unpaid walk-in voucher on overlapping dates is released. Does nothing unless it is CONFIRMED.
 */
function releaseOverlappingHolds(env: Env, bookingId: string) {
  return env.DB.prepare(`
    UPDATE bookings
    SET status = 'CANCELLED_BY_GCASH_PRIORITY', payment_status = 'NOT_PAID'
    WHERE status = 'PENDING_HOLD' AND id <> ?
      AND EXISTS (
        SELECT 1 FROM bookings confirmed
        WHERE confirmed.id = ? AND confirmed.status = 'CONFIRMED'
          AND ${rowsOverlapSql('bookings', 'confirmed')}
      )
  `).bind(bookingId, bookingId)
}

/** GET /api/admin/users — every account with successful / failed booking counts and history. */
async function adminUsers(env: Env) {
  const [users, bookings] = await Promise.all([
    env.DB.prepare('SELECT id, full_name, username, email, role, created_at FROM users ORDER BY created_at DESC')
      .all<AdminUserRow>(),
    env.DB.prepare(`
      SELECT id, user_id, reference_number, hold_reference_number, accommodation_name, tour_type,
             check_in_date, check_out_date, base_resort_price, paid_amount, status, payment_status,
             payment_tier, expires_at, created_at
      FROM bookings WHERE user_id IS NOT NULL ORDER BY created_at DESC
    `).all<UserBookingRow>(),
  ])
  return json(buildAdminUsers(users.results, bookings.results))
}

/**
 * DELETE /api/admin/users/:id[?purgeBookings=true]. By default the account's bookings and
 * payments are kept (user_id → NULL via ON DELETE SET NULL, name/email stay on each booking).
 * purgeBookings deletes them too (test accounts). Admins can't remove themselves or the last
 * admin, and admin accounts can't be purged: walk-in bookings are recorded under the admin.
 */
async function removeUser(env: Env, auth: AuthUser, userId: string, purgeBookings: boolean) {
  if (userId === auth.id) return json({ message: 'You cannot remove your own admin account.', reason: 'SELF' }, 400)
  const target = await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
  if (!target) return json({ message: 'User not found.', reason: 'NOT_FOUND' }, 404)
  if (target.role === 'ADMIN' && purgeBookings) {
    return json({ message: 'Admin accounts can only be removed with their records kept, because walk-in cash bookings are recorded under the admin who logged them.', reason: 'ADMIN_PURGE' }, 400)
  }
  // The delete re-checks the last-admin rule itself, so two admins can't remove each other at once.
  const deleteUser = env.DB.prepare(`
    DELETE FROM users WHERE id = ?
      AND (role <> 'ADMIN' OR (SELECT COUNT(*) FROM users WHERE role = 'ADMIN') > 1)
  `).bind(userId)
  if (purgeBookings) {
    const proofs = await env.DB.prepare(`
      SELECT proof_storage_key AS key FROM bookings WHERE user_id = ? AND proof_storage_key IS NOT NULL
      UNION
      SELECT p.proof_storage_key FROM booking_payments p JOIN bookings b ON b.id = p.booking_id
      WHERE b.user_id = ? AND p.proof_storage_key IS NOT NULL
    `).bind(userId, userId).all<{ key: string }>()
    const results = await env.DB.batch([
      env.DB.prepare('DELETE FROM booking_payments WHERE booking_id IN (SELECT id FROM bookings WHERE user_id = ?)').bind(userId),
      env.DB.prepare('DELETE FROM bookings WHERE user_id = ?').bind(userId),
      deleteUser,
    ])
    if (!results[2]?.meta.changes) return json({ message: 'User not found.', reason: 'NOT_FOUND' }, 404)
    await Promise.all(proofs.results.map((row) => env.PAYMENT_PROOFS.delete(row.key).catch(() => undefined)))
    const purged = results[1]?.meta.changes ?? 0
    return json({ message: `User removed with ${purged} booking${purged === 1 ? '' : 's'} purged.`, purgedBookings: purged, keptBookings: 0 })
  }
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE bookings
      SET customer_name = COALESCE(NULLIF(customer_name, ''), (SELECT full_name FROM users WHERE id = ?), ''),
          customer_email = COALESCE(NULLIF(customer_email, ''), (SELECT email FROM users WHERE id = ?), '')
      WHERE user_id = ?
    `).bind(userId, userId, userId),
    deleteUser,
  ])
  if (!results[1]?.meta.changes) {
    return json({ message: 'This is the last admin account. Create another admin before removing it.', reason: 'LAST_ADMIN' }, 409)
  }
  const kept = results[0]?.meta.changes ?? 0
  return json({ message: `User removed. ${kept} booking${kept === 1 ? '' : 's'} and payment records were kept.`, purgedBookings: 0, keptBookings: kept })
}

interface BlockedDateRow { id: string, accommodation_ids: string, start_date: string, end_date: string, reason: string, created_at: string }

function publicBlock(row: BlockedDateRow) {
  const ids = parseStoredAccommodationIds(row.accommodation_ids, '').filter(Boolean)
  return {
    id: row.id,
    accommodationIds: ids,
    accommodationName: ids.length ? ids.map((id) => rates[id]?.name ?? id).join(' + ') : 'Whole resort',
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    createdAt: row.created_at,
  }
}

async function listBlockedDates(env: Env) {
  const rows = await env.DB.prepare(`
    SELECT id, accommodation_ids, start_date, end_date, reason, created_at FROM blocked_dates
    WHERE end_date > ? ORDER BY start_date, created_at
  `).bind(manilaToday()).all<BlockedDateRow>()
  return json(rows.results.map(publicBlock))
}

/** POST /api/admin/blocked-dates — { accommodationIds?: string[] ([] = whole resort), startDate, endDate (exclusive), reason } */
async function addBlockedDate(request: Request, env: Env, auth: AuthUser) {
  const parsed = await readJson(request)
  if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
  const body = parsed.body
  const rawIds = isRecord(body) ? body.accommodationIds ?? [] : null
  const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : ''
  const valid = isRecord(body) && Array.isArray(rawIds) &&
    rawIds.every((id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(rates, id)) &&
    validDateInput(body.startDate) && validDateInput(body.endDate) && body.endDate > body.startDate &&
    reason.length <= 200 &&
    (Date.parse(`${body.endDate}T00:00:00Z`) - Date.parse(`${body.startDate}T00:00:00Z`)) / 86_400_000 <= 366
  if (!valid || !isRecord(body) || !Array.isArray(rawIds)) {
    return json({ message: 'Choose valid dates (the end must be after the start, up to one year), valid accommodations, and a reason of 200 characters or fewer.' }, 400)
  }
  const startDate = body.startDate as string
  const endDate = body.endDate as string
  if (endDate <= manilaToday()) return json({ message: 'Blocked dates must include today or a future date.' }, 400)
  const ids = rawIds.length ? parseAccommodationIds({ accommodationIds: rawIds }) ?? [] : []
  const id = `BLK-${crypto.randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()}`
  await env.DB.prepare(`
    INSERT INTO blocked_dates (id, accommodation_ids, start_date, end_date, reason, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, JSON.stringify(ids), startDate, endDate, reason, auth.id).run()
  // Confirmed bookings already on these dates aren't cancelled; list them for rescheduling.
  const conflicts = await env.DB.prepare(`
    SELECT b.reference_number FROM bookings AS b, blocked_dates AS bd
    WHERE bd.id = ? AND b.status = 'CONFIRMED'
      AND bd.start_date < b.check_out_date AND bd.end_date > b.check_in_date
      AND (bd.accommodation_ids = '[]' OR EXISTS (
        SELECT 1 FROM json_each(bd.accommodation_ids) AS blk_a, json_each(${accommodationIdsSql('b')}) AS blk_b
        WHERE blk_a.value = blk_b.value
      ))
    ORDER BY b.check_in_date
  `).bind(id).all<{ reference_number: string }>()
  return json({ id, conflictingReferences: conflicts.results.map((row) => row.reference_number) }, 201)
}

/**
 * PATCH /api/admin/bookings/:id/reschedule — { checkInDate }. Moves a confirmed booking,
 * keeping its length of stay, reference number, price, and payments. Refused if the new dates
 * conflict with another confirmed booking or blocked dates; overlapping holds are released.
 */
async function rescheduleBooking(request: Request, env: Env, bookingId: string) {
  const parsed = await readJson(request)
  if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
  const checkInDate = isRecord(parsed.body) ? parsed.body.checkInDate : undefined
  if (!validDateInput(checkInDate)) return json({ message: 'Choose a valid new check-in date.' }, 400)
  if (checkInDate < manilaToday()) return json({ message: 'The new check-in date must be today or later.' }, 400)
  const booking = await env.DB.prepare('SELECT status, check_in_date, check_out_date FROM bookings WHERE id = ?')
    .bind(bookingId).first<{ status: string, check_in_date: string, check_out_date: string }>()
  if (!booking) return json({ message: 'Booking not found.', reason: 'NOT_FOUND' }, 404)
  if (booking.status !== 'CONFIRMED') return json({ message: 'Only confirmed bookings can be rescheduled.', reason: 'NOT_CONFIRMED' }, 409)
  if (booking.check_in_date === checkInDate) return json({ message: 'The booking already starts on that date.', reason: 'UNCHANGED' }, 400)
  const nights = Math.round((Date.parse(`${booking.check_out_date}T00:00:00Z`) - Date.parse(`${booking.check_in_date}T00:00:00Z`)) / 86_400_000)
  const [y, m, d] = checkInDate.split('-').map(Number)
  const checkOutDate = new Date(Date.UTC(y, m - 1, d + nights)).toISOString().slice(0, 10)
  const results = await env.DB.batch([
    // Only if the booking is unchanged since it was read, and the new dates are open.
    env.DB.prepare(`
      UPDATE bookings SET check_in_date = ?, check_out_date = ?
      WHERE id = ? AND status = 'CONFIRMED' AND check_in_date = ? AND check_out_date = ?
        AND NOT EXISTS (
          SELECT 1 FROM bookings other
          WHERE other.id <> bookings.id AND other.status = 'CONFIRMED'
            AND other.check_in_date < ? AND other.check_out_date > ?
            AND ${sharesSpaceSql(accommodationIdsSql('other'), accommodationIdsSql('bookings'))}
        )
        AND NOT ${blockMatchesSql(accommodationIdsSql('bookings'), '?', '?')}
    `).bind(
      checkInDate, checkOutDate, bookingId, booking.check_in_date, booking.check_out_date,
      // other confirmed bookings vs. the new dates
      checkOutDate, checkInDate,
      // blocked dates vs. the new dates (check-out, check-in)
      checkOutDate, checkInDate,
    ),
    releaseOverlappingHolds(env, bookingId),
  ])
  if (!results[0]?.meta.changes) {
    return json({ message: 'Those dates conflict with another confirmed booking or blocked dates. Choose another date.', reason: 'DATE_TAKEN' }, 409)
  }
  return json({ message: 'Booking rescheduled. Its reference number and payments are unchanged.', ok: true, checkInDate, checkOutDate })
}

/** Marks every pending cash hold past its check-in date as EXPIRED. Returns how many expired. */
async function expirePendingHolds(env: Env) {
  const [holds, checkouts] = await env.DB.batch([
    env.DB.prepare(`
      UPDATE bookings SET status = 'EXPIRED', payment_status = 'NOT_PAID'
      WHERE status = 'PENDING_HOLD' AND expires_at <= ?
    `).bind(new Date().toISOString()),
    // Unfinished GCash checkouts. A late payment is still recorded by recordGatewayPayment.
    env.DB.prepare(`
      UPDATE bookings SET status = 'EXPIRED', payment_status = 'NOT_PAID'
      WHERE status = 'PENDING' AND payment_status = 'UNPAID'
        AND payment_tier = 'ONLINE_GCASH_RESERVATION' AND gateway_payment_id IS NULL
        AND julianday(created_at) <= julianday('now', ?)
    `).bind(`-${ABANDONED_CHECKOUT_HOURS} hours`),
  ])
  return (holds?.meta.changes ?? 0) + (checkouts?.meta.changes ?? 0)
}

const holdRefusalMessages = {
  DATE_CONFIRMED: 'These dates were already secured by a confirmed booking. Please choose another date or accommodation.',
  DATE_BLOCKED: 'The resort has closed these dates (maintenance or private use). Please choose another date or accommodation.',
  ALREADY_HELD: 'You already have an active walk-in voucher for these dates. Pay in cash at the resort, or secure them now with the GCash deposit.',
  HOLD_LIMIT: `You can have up to ${MAX_ACTIVE_HOLDS_PER_USER} active walk-in vouchers at a time. Wait for one to expire, or secure a date with the GCash deposit.`,
} as const

/** POST /api/bookings/pending-hold — Priority #2 "reserve now, pay cash later" walk-in voucher. */
async function createPendingHold(request: Request, env: Env, user: AuthUser) {
  const parsed = await readJson(request)
  if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
  const booking = getBookingDetails(parsed.body)
  if (!booking) {
    return json({ message: guestLimitMessage(parsed.body) ?? 'Booking dates, accommodation, tour type, or guest details are invalid. Refresh the page and check the current rates.' }, 400)
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  if (booking.checkInDate < today) return json({ message: 'Choose a check-in date from today onward.' }, 400)

  await expirePendingHolds(env)
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresAt = voucherExpiresAt(booking.checkInDate).toISOString()
  const bookingId = `TS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = referenceNumber('HOLD')
    let inserted: D1Result
    try {
      // One atomic statement. Only a confirmed booking blocks the date: other guests' holds
      // don't, so the date stays open and whoever is confirmed first gets it. A guest can't
      // hold the same slot twice and is limited to MAX_ACTIVE_HOLDS_PER_USER active holds.
      inserted = await env.DB.prepare(`
        INSERT INTO bookings (
          id, user_id, customer_name, customer_email, reference_number, payment_tier,
          base_resort_price, base_deposit_amount, gateway_fee_amount, total_online_paid,
          cash_balance_due, accommodation_id, accommodation_name, tour_type,
          check_in_date, check_out_date, adults, seniors_pwd, children, guest_count,
          estimated_total, deposit_required, paid_amount, status, payment_status,
          payment_reference, priority_rank, expires_at, accommodation_ids, extra_guests
        )
        SELECT ?, ?, ?, ?, ?, 'PENDING_CASH_INQUIRY',
               ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
               ?, ?, 0, 'PENDING_HOLD', 'UNPAID', ?, 2, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
          WHERE (status = 'CONFIRMED' OR (status = 'PENDING_HOLD' AND expires_at > ? AND user_id = ?))
            AND check_in_date < ? AND check_out_date > ?
            AND ${requestedSpaceSql}
        )
        AND NOT ${requestedBlockSql}
        AND (
          SELECT COUNT(*) FROM bookings
          WHERE user_id = ? AND status = 'PENDING_HOLD' AND expires_at > ?
        ) < ?
      `).bind(
        bookingId, user.id, user.name, user.email, reference,
        booking.baseResortPrice, booking.baseDepositAmount, booking.baseResortPrice,
        booking.accommodationId, booking.accommodationName, booking.tourType,
        booking.checkInDate, booking.checkOutDate, booking.adults, booking.seniorsPwd,
        booking.children, booking.guestCount, booking.baseResortPrice, booking.baseDepositAmount,
        reference, expiresAt, booking.accommodationIdsJson, booking.extraGuestsJson,
        nowIso, user.id, booking.checkOutDate, booking.checkInDate, booking.accommodationIdsJson,
        booking.checkOutDate, booking.checkInDate, booking.accommodationIdsJson,
        user.id, nowIso, MAX_ACTIVE_HOLDS_PER_USER,
      ).run()
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') && attempt < 4) continue
      throw error
    }
    if (inserted.meta.changes) return json({ bookingId, referenceNumber: reference, expiresAt }, 201)

    // Nothing was written: report why.
    const reasons = await env.DB.prepare(`
      SELECT
        EXISTS (
          SELECT 1 FROM bookings
          WHERE status = 'CONFIRMED' AND check_in_date < ? AND check_out_date > ?
            AND ${requestedSpaceSql}
        ) AS confirmed,
        EXISTS (
          SELECT 1 FROM bookings
          WHERE status = 'PENDING_HOLD' AND user_id = ? AND expires_at > ? AND check_in_date < ? AND check_out_date > ?
            AND ${requestedSpaceSql}
        ) AS held,
        ${requestedBlockSql} AS blocked
    `).bind(
      booking.checkOutDate, booking.checkInDate, booking.accommodationIdsJson,
      user.id, nowIso, booking.checkOutDate, booking.checkInDate, booking.accommodationIdsJson,
      booking.checkOutDate, booking.checkInDate, booking.accommodationIdsJson,
    ).first<{ confirmed: number, held: number, blocked: number }>()
    const reason = reasons?.confirmed ? 'DATE_CONFIRMED'
      : reasons?.blocked ? 'DATE_BLOCKED'
      : reasons?.held ? 'ALREADY_HELD' : 'HOLD_LIMIT'
    return json({ message: holdRefusalMessages[reason], reason }, 409)
  }
  return json({ message: 'Could not generate a unique hold reference. Please try again.' }, 503)
}

/** POST /api/admin/bookings/:id/confirm-hold-cash — admin received the full cash payment for a hold. */
async function confirmHoldWithCash(env: Env, bookingId: string) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const cashReference = referenceNumber('CASH')
    const nowIso = new Date().toISOString()
    let results: D1Result[]
    try {
      results = await env.DB.batch([
        env.DB.prepare(`
          UPDATE bookings
          SET status = 'CONFIRMED', payment_status = 'PAID', payment_tier = 'WALKIN_CASH_NO_RESERVATION',
              payment_method = 'CASH', payment_amount = base_resort_price, paid_amount = base_resort_price,
              hold_reference_number = reference_number, reference_number = ?, payment_reference = ?,
              priority_rank = 1, expires_at = NULL
          WHERE id = ? AND status = 'PENDING_HOLD' AND expires_at > ?
            AND NOT EXISTS (
              SELECT 1 FROM bookings other
              WHERE other.id <> bookings.id AND other.status = 'CONFIRMED'
                AND ${rowsOverlapSql('other', 'bookings')}
            )
            AND NOT ${bookingRowBlockSql}
        `).bind(cashReference, cashReference, bookingId, nowIso),
        env.DB.prepare(`
          INSERT INTO booking_payments (id, booking_id, amount, method, reference, payer_account, source, status, verified_at)
          SELECT ?, id, base_resort_price, 'CASH', ?, '', 'ADMIN_CASH', 'RECEIVED', ?
          FROM bookings WHERE id = ? AND reference_number = ? AND changes() = 1
        `).bind(crypto.randomUUID(), cashReference, nowIso, bookingId, cashReference),
        releaseOverlappingHolds(env, bookingId),
      ])
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed') && attempt < 4) continue
      throw error
    }
    if (results[0]?.meta.changes && results[1]?.meta.changes) {
      return json({ message: 'Cash received. The hold is now a confirmed booking.', referenceNumber: cashReference })
    }
    const row = await env.DB.prepare('SELECT status, expires_at FROM bookings WHERE id = ?')
      .bind(bookingId).first<{ status: BookingStatus, expires_at: string | null }>()
    if (!row) return json({ message: 'Booking not found.' }, 404)
    if (row.status === 'EXPIRED' || (row.status === 'PENDING_HOLD' && row.expires_at && row.expires_at <= nowIso)) {
      await expirePendingHolds(env)
      return json({ message: 'This walk-in voucher has already expired. Ask the guest to book again.' }, 409)
    }
    if (row.status === 'PENDING_HOLD') {
      return json({ message: 'These dates were already secured by a confirmed booking or closed by the resort, so this hold cannot be confirmed.' }, 409)
    }
    return json({ message: 'Only an active walk-in voucher can be confirmed this way.' }, 409)
  }
  return json({ message: 'Could not generate a unique cash reference. Please try again.' }, 503)
}

async function recordGatewayPayment(
  env: Env,
  reference: string,
  checkoutId: string,
  paymentId: string,
  amountCents: number,
) {
  const booking = await env.DB.prepare(`
    SELECT id, payment_tier, payment_status, status, gateway_payment_id, gateway_checkout_id,
           total_online_paid
    FROM bookings WHERE reference_number = ?
  `).bind(reference).first<{
    id: string
    payment_tier: PaymentTier | null
    payment_status: PaymentStatus
    status: BookingStatus
    gateway_payment_id: string | null
    gateway_checkout_id: string | null
    total_online_paid: number
  }>()
  if (
    !booking || booking.payment_tier !== 'ONLINE_GCASH_RESERVATION' ||
    booking.gateway_checkout_id !== checkoutId
  ) return false
  if (booking.gateway_payment_id === paymentId) return true
  if (
    booking.gateway_payment_id ||
    // An expired checkout can still be paid late: the guest's money must always be recorded.
    !((booking.status === 'PENDING' && booking.payment_status === 'UNPAID') ||
      (booking.status === 'EXPIRED' && booking.payment_status === 'NOT_PAID')) ||
    Math.round(Number(booking.total_online_paid) * 100) !== amountCents
  ) return false

  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE bookings
      SET paid_amount = base_deposit_amount,
          payment_status = 'PARTIALLY_PAID',
          payment_amount = total_online_paid,
          payment_method = 'GCASH',
          status = CASE
            WHEN EXISTS (
              SELECT 1 FROM bookings other
              WHERE other.id <> bookings.id AND other.status = 'CONFIRMED'
                AND ${rowsOverlapSql('other', 'bookings')}
            ) OR ${bookingRowBlockSql} THEN 'DATE_UNAVAILABLE'
            ELSE 'CONFIRMED'
          END,
          gateway_payment_id = ?
      WHERE id = ? AND reference_number = ? AND gateway_checkout_id = ?
        AND payment_tier = 'ONLINE_GCASH_RESERVATION'
        AND ((payment_status = 'UNPAID' AND status = 'PENDING')
          OR (payment_status = 'NOT_PAID' AND status = 'EXPIRED'))
        AND ROUND(total_online_paid * 100) = ?
        AND gateway_payment_id IS NULL
    `).bind(paymentId, booking.id, reference, checkoutId, amountCents),
    env.DB.prepare(`
      INSERT INTO booking_payments (
        id, booking_id, amount, method, reference, payer_account, source, status, verified_at
      )
      SELECT ?, id, total_online_paid, 'GCASH', ?, '', 'CUSTOMER', 'RECEIVED', ?
      FROM bookings
      WHERE id = ? AND gateway_payment_id = ? AND changes() = 1
    `).bind(crypto.randomUUID(), paymentId, new Date().toISOString(), booking.id, paymentId),
    // Priority #1: a paid GCash reservation takes the slot from any unpaid hold.
    releaseOverlappingHolds(env, booking.id),
  ])
  if (results[0]?.meta.changes && results[1]?.meta.changes) return true
  const latest = await env.DB.prepare('SELECT gateway_payment_id FROM bookings WHERE id = ?')
    .bind(booking.id).first<{ gateway_payment_id: string | null }>()
  return latest?.gateway_payment_id === paymentId
}

function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function verifyHitpaySignature(rawBody: string, header: string | null, salt: string) {
  const actual = header?.trim().toLowerCase() ?? ''
  if (!/^[\da-f]{64}$/.test(actual)) return false
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const expected = hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody))))
  let difference = 0
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ actual.charCodeAt(index)
  }
  return difference === 0
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

async function hitpayWebhook(request: Request, env: Env) {
  const hitpay = hitpayConfig(env)
  if (!env.HITPAY_WEBHOOK_SALT || !hitpay) return json({ message: 'HitPay webhook is not configured.' }, 503)
  const rawBody = await request.text()
  if (encoder.encode(rawBody).length > 1024 * 1024) return json({ message: 'Webhook payload is too large.' }, 413)
  if (!await verifyHitpaySignature(rawBody, request.headers.get('Hitpay-Signature'), env.HITPAY_WEBHOOK_SALT)) {
    return json({ message: 'Invalid HitPay webhook signature.' }, 400)
  }
  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return json({ message: 'Invalid HitPay webhook payload.' }, 400)
  }
  const eventObject = request.headers.get('Hitpay-Event-Object')
  if ((eventObject && eventObject !== 'payment_request') || !isRecord(payload) || typeof payload.id !== 'string') {
    return json({ received: true })
  }

  let paymentRequest: Awaited<ReturnType<typeof fetchHitpayPaymentRequest>>
  try {
    paymentRequest = await fetchHitpayPaymentRequest(hitpay, payload.id)
  } catch (error) {
    // A non-2xx response makes HitPay retry the webhook later.
    console.error('Could not verify HitPay payment request:', error)
    return json({ message: 'Could not verify the payment with HitPay.' }, 502)
  }
  if (paymentRequest.status !== 'completed' || paymentRequest.currency !== 'PHP' ||
      !paymentRequest.referenceNumber || !Number.isFinite(paymentRequest.amount)) {
    return json({ received: true })
  }
  const recorded = await recordGatewayPayment(
    env,
    paymentRequest.referenceNumber,
    paymentRequest.id,
    paymentRequest.paymentId,
    Math.round(paymentRequest.amount * 100),
  )
  if (!recorded) console.error('Verified HitPay payment did not match a pending booking:', paymentRequest.referenceNumber)
  return json({ received: true })
}

async function geminiReply(apiKey: string, model: string, messages: NonNullable<ReturnType<typeof parseChatMessages>>) {
  const providerResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(GERAINT_ATTEMPT_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: GERAINT_SYSTEM_INSTRUCTION }] },
        contents: toGeminiContents(messages),
        generationConfig: GERAINT_GENERATION_CONFIG,
      }),
    },
  )
  let body: unknown = null
  try {
    body = await providerResponse.json()
  } catch {
    body = null
  }
  if (!providerResponse.ok) {
    const detail = isRecord(body) && isRecord(body.error) && typeof body.error.message === 'string' ? body.error.message : ''
    throw new Error(`HTTP ${providerResponse.status} ${detail}`.trim())
  }
  const candidate = isRecord(body) && Array.isArray(body.candidates) ? body.candidates[0] : undefined
  const parts = isRecord(candidate) && isRecord(candidate.content) && Array.isArray(candidate.content.parts)
    ? candidate.content.parts
    : []
  return parts
    .map((part) => (isRecord(part) && typeof part.text === 'string' && part.thought !== true ? part.text : ''))
    .join('')
    .trim()
}

async function geraintChat(request: Request, env: Env) {
  const apiKey = env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    console.error('Geraint chat is unavailable: the GEMINI_API_KEY secret is not set.')
    return json({ message: GERAINT_UNAVAILABLE_MESSAGE }, 503)
  }
  const parsed = await readJson(request)
  const messages = parsed.tooLarge ? null : parseChatMessages(parsed.body)
  if (!messages) return json({ message: 'Geraint could not read that message. Please send a shorter message and try again.' }, 400)

  for (const model of geraintModelChain(env.GEMINI_MODEL)) {
    try {
      const reply = await geminiReply(apiKey, model, messages)
      if (reply) return json({ reply })
      console.error(`Gemini model ${model} returned an empty reply.`)
    } catch (error) {
      console.error(`Gemini model ${model} failed:`, error instanceof Error ? error.message : error)
    }
  }
  return json({ message: GERAINT_UNAVAILABLE_MESSAGE }, 502)
}

function paymentPublic(row: BookingJoinedRow) {
  if (!row.joined_payment_id) return null
  return {
    id: row.joined_payment_id,
    amount: Number(row.joined_payment_amount),
    method: row.joined_payment_method,
    reference: row.joined_payment_reference ?? '',
    payerAccount: row.joined_payer_account ?? '',
    source: row.joined_payment_source,
    status: row.joined_payment_status,
    submittedAt: row.joined_payment_created_at,
    verifiedAt: row.joined_payment_verified_at,
    proofFileName: row.joined_payment_proof_name,
    hasProof: Boolean(row.joined_payment_proof_key),
  }
}

function publicBooking(row: BookingJoinedRow, payments: ReturnType<typeof paymentPublic>[]) {
  return {
    id: row.id,
    referenceNumber: row.reference_number,
    paymentTier: row.payment_tier,
    baseResortPrice: Number(row.base_resort_price),
    baseDepositAmount: Number(row.base_deposit_amount),
    gatewayFeeAmount: Number(row.gateway_fee_amount),
    totalOnlinePaid: Number(row.total_online_paid),
    cashBalanceDue: Number(row.cash_balance_due),
    gatewayPaymentId: row.gateway_payment_id,
    createdAt: row.created_at,
    customerName: row.customer_name,
    customerContact: row.customer_email,
    accommodationId: row.accommodation_id,
    accommodationIds: parseStoredAccommodationIds(row.accommodation_ids, row.accommodation_id),
    accommodationName: row.accommodation_name,
    tourType: row.tour_type,
    checkInDate: row.check_in_date,
    checkOutDate: row.check_out_date,
    guests: { adults: row.adults, seniorsPwd: row.seniors_pwd, children: row.children },
    guestCount: row.guest_count,
    extraGuests: parseStoredExtraGuests(row.extra_guests),
    estimatedTotal: Number(row.estimated_total),
    depositRequired: Number(row.deposit_required),
    paymentAmount: row.payment_amount === null ? null : Number(row.payment_amount),
    paidAmount: Number(row.paid_amount),
    status: row.status,
    paymentStatus: row.payment_tier === 'WALKIN_CASH_NO_RESERVATION' &&
      row.payment_status === 'PAID'
      ? 'PAID_CASH'
      : row.payment_status,
    paymentMethod: row.payment_method,
    paymentReference: row.payment_reference,
    proofFileName: row.proof_file_name,
    hasPaymentProof: Boolean(row.proof_storage_key),
    payments,
    expiresAt: row.expires_at,
    priorityRank: row.priority_rank === null ? null : Number(row.priority_rank),
    holdReferenceNumber: row.hold_reference_number,
  }
}

async function loadBookings(env: Env, userId?: string) {
  const where = userId ? 'WHERE b.user_id = ?' : ''
  const query = `
    SELECT b.id, b.user_id, COALESCE(NULLIF(b.customer_name, ''), u.full_name) AS customer_name,
           COALESCE(NULLIF(b.customer_email, ''), u.email, '') AS customer_email,
           b.accommodation_id, b.accommodation_ids, b.accommodation_name, b.tour_type, b.check_in_date, b.check_out_date,
           b.adults, b.seniors_pwd, b.children, b.guest_count, b.extra_guests, b.estimated_total, b.deposit_required,
           b.reference_number, b.payment_tier, b.base_resort_price, b.base_deposit_amount,
           b.gateway_fee_amount, b.total_online_paid, b.cash_balance_due,
           b.gateway_payment_id, b.gateway_checkout_id,
           b.payment_amount, b.paid_amount, b.status, b.payment_status, b.payment_method,
           b.payment_reference, b.proof_storage_key, b.proof_file_name, b.created_at,
           b.expires_at, b.priority_rank, b.hold_reference_number,
           p.id AS joined_payment_id, p.amount AS joined_payment_amount, p.method AS joined_payment_method,
           p.reference AS joined_payment_reference, p.payer_account AS joined_payer_account,
           p.source AS joined_payment_source, p.status AS joined_payment_status,
           p.proof_storage_key AS joined_payment_proof_key, p.proof_file_name AS joined_payment_proof_name,
           p.created_at AS joined_payment_created_at, p.verified_at AS joined_payment_verified_at
    FROM bookings b
    LEFT JOIN users u ON u.id = b.user_id
    LEFT JOIN booking_payments p ON p.booking_id = b.id
    ${where}
    ORDER BY b.created_at DESC, p.created_at ASC
  `
  const result = userId
    ? await env.DB.prepare(query).bind(userId).all<BookingJoinedRow>()
    : await env.DB.prepare(query).all<BookingJoinedRow>()
  const bookings = new Map<string, { row: BookingJoinedRow; payments: ReturnType<typeof paymentPublic>[] }>()
  for (const row of result.results) {
    let booking = bookings.get(row.id)
    if (!booking) {
      booking = { row, payments: [] }
      bookings.set(row.id, booking)
    }
    const payment = paymentPublic(row)
    if (payment) booking.payments.push(payment)
  }
  return Array.from(bookings.values(), ({ row, payments }) => publicBooking(row, payments))
}

function getPathId(pathname: string, pattern: RegExp) {
  const match = pathname.match(pattern)
  if (!match) return null
  try {
    return decodeURIComponent(match[1])
  } catch {
    return null
  }
}

async function readFormFile(form: FormData) {
  const files = form.getAll('proof')
  if (files.length !== 1) return { error: 'Upload one payment screenshot at a time.' } as const
  const file = files[0]
  if (!(file instanceof File) || file.size === 0) return { error: 'Choose a payment method and attach a screenshot of the payment.' } as const
  if (file.size > 5 * 1024 * 1024) return { error: 'Payment screenshot must be 5 MB or smaller.' } as const
  const bytes = new Uint8Array(await file.arrayBuffer())
  let image: { mime: string; extension: string } | null = null
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    image = { mime: 'image/png', extension: '.png' }
  } else if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    image = { mime: 'image/jpeg', extension: '.jpg' }
  } else if (bytes.length >= 12 &&
      decoder.decode(bytes.subarray(0, 4)) === 'RIFF' &&
      decoder.decode(bytes.subarray(8, 12)) === 'WEBP') {
    image = { mime: 'image/webp', extension: '.webp' }
  }
  if (!image || file.type !== image.mime) return { error: 'Upload a valid PNG, JPEG, or WebP payment screenshot.' } as const
  const safeName = file.name.replace(/[\\/]/g, '_').slice(0, 180) || `payment-proof${image.extension}`
  return { bytes, mime: image.mime, extension: image.extension, fileName: safeName } as const
}

async function createBooking(request: Request, env: Env, user: AuthUser) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ message: 'Enter valid booking details and attach proof of payment.' }, 400)
  }
  const bookingText = form.get('booking')
  if (typeof bookingText !== 'string' || encoder.encode(bookingText).length > 10 * 1024) {
    return json({ message: 'Booking details must be 10 KB or smaller.' }, 413)
  }
  let body: unknown
  try {
    body = JSON.parse(bookingText)
  } catch {
    return json({ message: 'Booking details are not valid JSON.' }, 400)
  }
  if (!isRecord(body) || !isRecord(body.guests)) {
    return json({ message: 'Enter valid booking details and attach proof of payment.' }, 400)
  }
  const file = await readFormFile(form)
  if ('error' in file) return json({ message: file.error }, 400)
  const method = form.get('paymentMethod')
  const reference = typeof form.get('paymentReference') === 'string' ? String(form.get('paymentReference')).trim() : ''
  const payerAccount = typeof form.get('payerAccount') === 'string' ? String(form.get('payerAccount')).trim() : ''
  const amountText = String(form.get('paymentAmount') ?? '')
  const paymentAmount = /^\d+(?:\.\d{1,2})?$/.test(amountText) ? Number(amountText) : Number.NaN
  if (!paymentMethods.includes(method as PaymentMethod)) return json({ message: 'Choose GCash, Maya, bank transfer, or other.' }, 400)
  if (!reference || reference.length > 120) return json({ message: 'Enter the transaction reference number (120 characters or fewer).' }, 400)
  if (!payerAccount || payerAccount.length > 200) return json({ message: 'Enter the payer account name and number (200 characters or fewer).' }, 400)

  const adults = body.guests.adults
  const seniorsPwd = body.guests.seniorsPwd
  const children = body.guests.children
  const guestCount = Number(adults) + Number(seniorsPwd) + Number(children)
  const dateRangeIsValid = validDate(body.checkInDate) && validDate(body.checkOutDate) && body.checkOutDate > body.checkInDate
  const days = dateRangeIsValid
    ? (Date.parse(`${body.checkOutDate}T00:00:00.000Z`) - Date.parse(`${body.checkInDate}T00:00:00.000Z`)) / 86_400_000
    : 0
  const legacyAccommodationIds = parseAccommodationIds(body)
  const legacyExtras = parseExtraGuests(body)
  const pricing = tourTypes.includes(body.tourType as TourType) && legacyAccommodationIds && legacyExtras !== null &&
      [adults, seniorsPwd, children].every((value) => Number.isInteger(value) && Number(value) >= 0) && days > 0
    ? calculatePricing(legacyAccommodationIds, body.tourType as TourType, {
      adults: Number(adults), seniorsPwd: Number(seniorsPwd), children: Number(children),
    }, days, legacyExtras)
    : null
  if (!pricing || !legacyAccommodationIds || !dateRangeIsValid || guestCount < 1 ||
      typeof body.estimatedTotal !== 'number' || Math.round(body.estimatedTotal * 100) !== Math.round(pricing.total * 100) ||
      typeof body.depositRequired !== 'number' || Math.round(body.depositRequired * 100) !== Math.round(pricing.deposit * 100) ||
      !Number.isFinite(paymentAmount) || paymentAmount < pricing.deposit || paymentAmount > pricing.total) {
    return json({ message: 'Booking dates, tour type, guests, pricing, or initial payment amount are invalid. Refresh the page and check the current rates.' }, 400)
  }

  const bookingId = `TS-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
  const paymentId = crypto.randomUUID()
  const storageKey = `${crypto.randomUUID()}${file.extension}`
  await env.PAYMENT_PROOFS.put(storageKey, file.bytes, { httpMetadata: { contentType: file.mime } })
  try {
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO bookings (
          id, user_id, accommodation_id, accommodation_name, tour_type, check_in_date, check_out_date,
          adults, seniors_pwd, children, guest_count, estimated_total, deposit_required,
          payment_amount, paid_amount, status, payment_status, payment_method, payment_reference,
          proof_storage_key, proof_file_name, customer_name, customer_email,
          reference_number, payment_tier, base_resort_price, base_deposit_amount,
          gateway_fee_amount, total_online_paid, cash_balance_due, accommodation_ids, extra_guests
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'PENDING', 'PENDING_REVIEW', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 0, 0, ?, ?, ?)
      `).bind(
        bookingId, user.id, legacyAccommodationIds[0], pricing.accommodationName, body.tourType,
        body.checkInDate, body.checkOutDate, adults, seniorsPwd, children, guestCount,
        pricing.total, pricing.deposit, paymentAmount, method, reference, storageKey, file.fileName,
        user.name, user.email, `TRP-LEGACY-${bookingId}`, pricing.total, pricing.deposit, pricing.total,
        JSON.stringify(legacyAccommodationIds),
        pricing.extraGuests ? JSON.stringify(pricing.extraGuests) : null,
      ),
      env.DB.prepare(`
        INSERT INTO booking_payments (
          id, booking_id, amount, method, reference, payer_account, source, status,
          proof_storage_key, proof_file_name
        ) VALUES (?, ?, ?, ?, ?, ?, 'CUSTOMER', 'PENDING_REVIEW', ?, ?)
      `).bind(paymentId, bookingId, paymentAmount, method, reference, payerAccount, storageKey, file.fileName),
    ])
  } catch (error) {
    await env.PAYMENT_PROOFS.delete(storageKey)
    throw error
  }
  return json({ id: bookingId }, 201)
}

async function submitPaymentProof(request: Request, env: Env, user: AuthUser, bookingId: string) {
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return json({ message: 'Choose a payment method and attach a screenshot of the payment.' }, 400)
  }
  const file = await readFormFile(form)
  if ('error' in file) return json({ message: file.error }, 400)
  const method = form.get('paymentMethod')
  const reference = String(form.get('paymentReference') ?? '').trim()
  const payerAccount = String(form.get('payerAccount') ?? '').trim()
  const amountText = String(form.get('paymentAmount') ?? '')
  const amount = /^\d+(?:\.\d{1,2})?$/.test(amountText) ? Number(amountText) : Number.NaN
  if (!paymentMethods.includes(method as PaymentMethod)) return json({ message: 'Choose GCash, Maya, bank transfer, or other.' }, 400)
  if (!reference || reference.length > 120) return json({ message: 'Enter the transaction reference number (120 characters or fewer).' }, 400)
  if (!payerAccount || payerAccount.length > 200) return json({ message: 'Enter the payer account name and number (200 characters or fewer).' }, 400)

  const booking = await env.DB.prepare(`
    SELECT user_id, status, payment_status, deposit_required, estimated_total, paid_amount
    FROM bookings WHERE id = ?
  `).bind(bookingId).first<{
    user_id: string; status: BookingStatus; payment_status: PaymentStatus
    deposit_required: number; estimated_total: number; paid_amount: number
  }>()
  if (!booking || booking.user_id !== user.id) return json({ message: 'Booking not found.' }, 404)
  const minimum = Number(booking.paid_amount) > 0 ? 0.01 : Number(booking.deposit_required)
  const maximum = Number(booking.estimated_total) - Number(booking.paid_amount)
  if (!Number.isFinite(amount) || amount < minimum || amount > maximum) {
    return json({
      message: Number(booking.paid_amount) > 0
        ? `Payment must be more than zero and no more than the remaining balance of ${maximum.toFixed(2)}.`
        : `Payment must be at least ${Number(booking.deposit_required).toFixed(2)} and no more than the total ${Number(booking.estimated_total).toFixed(2)}.`,
    }, 400)
  }

  const paymentId = crypto.randomUUID()
  const storageKey = `${crypto.randomUUID()}${file.extension}`
  await env.PAYMENT_PROOFS.put(storageKey, file.bytes, { httpMetadata: { contentType: file.mime } })
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO booking_payments (
          id, booking_id, amount, method, reference, payer_account, source, status,
          proof_storage_key, proof_file_name
        )
        SELECT ?, id, ?, ?, ?, ?, 'CUSTOMER', 'PENDING_REVIEW', ?, ?
        FROM bookings
        WHERE id = ? AND user_id = ? AND status NOT IN (${inactiveForPaymentSql})
          AND payment_status NOT IN ('PENDING_REVIEW', 'PAID')
          AND ROUND(? * 100) >= ROUND(CASE WHEN paid_amount = 0 THEN deposit_required ELSE 0.01 END * 100)
          AND ROUND(? * 100) <= ROUND((estimated_total - paid_amount) * 100)
      `).bind(
        paymentId, amount, method, reference, payerAccount, storageKey, file.fileName,
        bookingId, user.id, amount, amount,
      ),
      env.DB.prepare(`
        UPDATE bookings
        SET payment_status = 'PENDING_REVIEW', payment_amount = ?, payment_method = ?,
            payment_reference = ?, proof_storage_key = ?, proof_file_name = ?
        WHERE id = ? AND user_id = ?
          AND EXISTS (SELECT 1 FROM booking_payments WHERE id = ? AND booking_id = ? AND status = 'PENDING_REVIEW')
      `).bind(amount, method, reference, storageKey, file.fileName, bookingId, user.id, paymentId, bookingId),
    ])
    if (!results[0]?.meta.changes) {
      await env.PAYMENT_PROOFS.delete(storageKey)
      return json({ message: 'Payment proof cannot be submitted for this booking in its current state.' }, 409)
    }
  } catch (error) {
    await env.PAYMENT_PROOFS.delete(storageKey)
    throw error
  }
  return json({ message: 'Payment proof sent to the resort for review.' })
}

async function reviewPayment(env: Env, bookingId: string, paymentId: string, received: boolean) {
  const timestamp = new Date().toISOString()
  if (received) {
    const results = await env.DB.batch([
      env.DB.prepare(`
        UPDATE bookings
        SET paid_amount = ROUND(paid_amount + (
              SELECT amount FROM booking_payments WHERE id = ? AND booking_id = ? AND status = 'PENDING_REVIEW'
            ), 2),
            payment_status = CASE
              WHEN ROUND((paid_amount + (SELECT amount FROM booking_payments WHERE id = ? AND booking_id = ?)) * 100) >= ROUND(estimated_total * 100) THEN 'PAID'
              ELSE 'PARTIALLY_PAID'
            END,
            status = CASE
              WHEN EXISTS (
                SELECT 1 FROM bookings other
                WHERE other.id <> bookings.id AND other.status = 'CONFIRMED'
                  AND ${rowsOverlapSql('other', 'bookings')}
              ) OR ${bookingRowBlockSql} THEN 'DATE_UNAVAILABLE'
              ELSE 'CONFIRMED'
            END
        WHERE id = ? AND status NOT IN (${inactiveForPaymentSql})
          AND EXISTS (
            SELECT 1 FROM booking_payments p
            WHERE p.id = ? AND p.booking_id = bookings.id AND p.status = 'PENDING_REVIEW'
              AND ROUND((paid_amount + p.amount) * 100) <= ROUND(estimated_total * 100)
          )
      `).bind(paymentId, bookingId, paymentId, bookingId, bookingId, paymentId),
      env.DB.prepare(`
        UPDATE booking_payments
        SET status = 'RECEIVED', verified_at = ?
        WHERE id = ? AND booking_id = ? AND status = 'PENDING_REVIEW' AND changes() = 1
      `).bind(timestamp, paymentId, bookingId),
      releaseOverlappingHolds(env, bookingId),
    ])
    if (!results[0]?.meta.changes || !results[1]?.meta.changes) return false
    const status = await env.DB.prepare('SELECT status FROM bookings WHERE id = ?')
      .bind(bookingId).first<{ status: BookingStatus }>()
    return status?.status === 'DATE_UNAVAILABLE' ? 'DATE_UNAVAILABLE' : true
  }

  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE booking_payments SET status = 'NOT_RECEIVED', verified_at = ?
      WHERE id = ? AND booking_id = ? AND status = 'PENDING_REVIEW'
        AND EXISTS (SELECT 1 FROM bookings WHERE id = ? AND status NOT IN (${inactiveForPaymentSql}))
    `).bind(timestamp, paymentId, bookingId, bookingId),
    env.DB.prepare(`
      UPDATE bookings
      SET payment_status = CASE WHEN paid_amount > 0 THEN 'PARTIALLY_PAID' ELSE 'NOT_PAID' END,
          payment_amount = NULL, payment_method = NULL, payment_reference = '',
          proof_storage_key = NULL, proof_file_name = NULL
      WHERE id = ? AND changes() = 1
    `).bind(bookingId),
  ])
  return Boolean(results[0]?.meta.changes && results[1]?.meta.changes)
}

async function recordCashPayment(env: Env, bookingId: string, amount: number) {
  const paymentId = crypto.randomUUID()
  const timestamp = new Date().toISOString()
  const results = await env.DB.batch([
    env.DB.prepare(`
      UPDATE bookings
      SET paid_amount = ROUND(paid_amount + ?, 2),
          payment_status = CASE WHEN ROUND((paid_amount + ?) * 100) >= ROUND(estimated_total * 100) THEN 'PAID' ELSE 'PARTIALLY_PAID' END,
          payment_method = 'CASH', payment_amount = ?, payment_reference = '',
          proof_storage_key = NULL, proof_file_name = NULL,
          status = CASE
            WHEN EXISTS (
              SELECT 1 FROM bookings other
              WHERE other.id <> bookings.id AND other.status = 'CONFIRMED'
                AND ${rowsOverlapSql('other', 'bookings')}
            ) OR ${bookingRowBlockSql} THEN 'DATE_UNAVAILABLE'
            ELSE 'CONFIRMED'
          END
      WHERE id = ? AND status NOT IN (${inactiveForPaymentSql})
        AND payment_status NOT IN ('PAID', 'PENDING_REVIEW')
        AND NOT EXISTS (SELECT 1 FROM booking_payments WHERE booking_id = ? AND status = 'PENDING_REVIEW')
        AND ROUND(? * 100) >= ROUND(CASE WHEN paid_amount = 0 THEN deposit_required ELSE 0.01 END * 100)
        AND ROUND(? * 100) <= ROUND((estimated_total - paid_amount) * 100)
    `).bind(amount, amount, amount, bookingId, bookingId, amount, amount),
    env.DB.prepare(`
      INSERT INTO booking_payments (id, booking_id, amount, method, source, status, verified_at)
      SELECT ?, ?, ?, 'CASH', 'ADMIN_CASH', 'RECEIVED', ?
      WHERE changes() = 1
    `).bind(paymentId, bookingId, amount, timestamp),
    releaseOverlappingHolds(env, bookingId),
  ])
  if (!results[0]?.meta.changes || !results[1]?.meta.changes) return false
  const status = await env.DB.prepare('SELECT status FROM bookings WHERE id = ?')
    .bind(bookingId).first<{ status: BookingStatus }>()
  return status?.status === 'DATE_UNAVAILABLE' ? 'DATE_UNAVAILABLE' : true
}

async function api(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url)
  if (!pathname.startsWith('/api/')) return null
  const method = request.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = request.headers.get('Origin')
    if (origin && origin !== new URL(request.url).origin) {
      return json({ message: 'Request origin is not allowed.' }, 403)
    }
  }
  if (method === 'POST' && (pathname === '/api/payments/hitpay-webhook' || pathname === '/api/webhooks/hitpay')) {
    try {
      return await hitpayWebhook(request, env)
    } catch (error) {
      // Generic body (no stack or DB details); the 5xx makes HitPay retry the delivery.
      console.error('HitPay webhook failed:', error)
      return json({ message: 'The server could not process the webhook.' }, 500)
    }
  }
  // Multipart uploads (one ≤5 MB screenshot + small fields): refuse oversized bodies before buffering.
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (method === 'POST' && declaredLength > 6 * 1024 * 1024) {
    return json({ message: 'Request body is too large.' }, 413)
  }
  const configError = configurationError(env)
  if (pathname !== '/api/health' && pathname !== '/api/availability' && configError) {
    return json({ message: configError }, 503)
  }

  try {
    if (method === 'GET' && pathname === '/api/health') {
      let databaseConnected = false
      try {
        databaseConnected = Boolean(await env.DB.prepare('SELECT 1 AS connected').first())
      } catch (error) {
        console.error('Health check could not reach D1:', error)
      }
      const healthy = databaseConnected && !configError
      return json({
        status: healthy ? 'ok' : 'unavailable',
        databaseConfigured: true,
        databaseConnected,
        jwtConfigured: !configError,
      }, healthy ? 200 : 503)
    }

    if (method === 'GET' && pathname === '/api/availability') {
      const url = new URL(request.url)
      // ?accommodationIds=bahay-hapag,balai-delnor, or the older single ?accommodationId=...
      const rawIds = url.searchParams.get('accommodationIds') ?? url.searchParams.get('accommodationId')
      const accommodationIds = rawIds
        ? parseAccommodationIds({ accommodationIds: rawIds.split(',').map((id) => id.trim()) })
        : null
      const checkInDate = url.searchParams.get('checkInDate')
      const checkOutDate = url.searchParams.get('checkOutDate')
      if (
        !accommodationIds ||
        !validDate(checkInDate) || !validDate(checkOutDate) || checkOutDate <= checkInDate
      ) {
        return json({ message: 'Choose a valid accommodation and date range.' }, 400)
      }
      await expirePendingHolds(env)
      const result = await env.DB.prepare(`
        SELECT NOT EXISTS (
          SELECT 1 FROM bookings
          WHERE status = 'CONFIRMED'
            AND check_in_date < ?
            AND check_out_date > ?
            AND ${requestedSpaceSql}
        ) AS available
      `).bind(checkOutDate, checkInDate, JSON.stringify(accommodationIds)).first<{ available: number }>()
      if (!result) throw new Error('Could not check accommodation availability.')
      const held = await env.DB.prepare(`
        SELECT EXISTS (
          SELECT 1 FROM bookings
          WHERE status = 'PENDING_HOLD' AND expires_at > ?
            AND check_in_date < ? AND check_out_date > ?
            AND ${requestedSpaceSql}
        ) AS held
      `).bind(new Date().toISOString(), checkOutDate, checkInDate, JSON.stringify(accommodationIds))
        .first<{ held: number }>()
      const blocked = await env.DB.prepare(`SELECT ${requestedBlockSql} AS blocked`)
        .bind(checkOutDate, checkInDate, JSON.stringify(accommodationIds)).first<{ blocked: number }>()
      // blocked: the resort closed these dates (maintenance / private use).
      return json({
        available: Boolean(result.available) && !blocked?.blocked,
        pendingHold: Boolean(held?.held),
        blocked: Boolean(blocked?.blocked),
      })
    }

    if (method === 'POST' && pathname === '/api/chat') {
      if (!await limited(env, request, 'chat', 60 * 1000, 20)) {
        return json({ message: 'Woof! Geraint needs a quick breather. Please wait a minute before sending more messages.' }, 429)
      }
      return geraintChat(request, env)
    }

    if (method === 'POST' && pathname === '/api/auth/register') {
      if (!await limited(env, request, 'register', 60 * 60 * 1000, 10)) {
        return json({ message: 'Too many account creation attempts. Try again later.' }, 429)
      }
      const parsed = await readJson(request)
      if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
      const body = parsed.body
      if (!isRecord(body)) return json({ message: 'Enter your name, email, username, and password.' }, 400)
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (fullName.length < 1 || fullName.length > 100) return json({ message: 'Enter a name between 1 and 100 characters.' }, 400)
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ message: 'Enter a valid email address.' }, 400)
      if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
        return json({ message: 'Username must be 3–32 characters: lowercase letters, numbers, dots, underscores, or hyphens.' }, 400)
      }
      if (password.length < 12 || encoder.encode(password).length > 72) {
        return json({ message: 'Password must be at least 12 characters and no more than 72 UTF-8 bytes.' }, 400)
      }
      const id = crypto.randomUUID()
      try {
        await env.DB.prepare(`
          INSERT INTO users (id, full_name, email, username, password_hash, role)
          VALUES (?, ?, ?, ?, ?, 'CUSTOMER')
        `).bind(id, fullName, email, username, await passwordHash(password)).run()
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        if (message.includes('UNIQUE constraint failed')) return json({ message: 'That email or username is already registered.' }, 409)
        throw error
      }
      const user = { id, email, username, name: fullName, role: 'CUSTOMER' as const }
      return json({ user, token: await signToken(user, env.JWT_SECRET!) }, 201)
    }

    if (method === 'POST' && pathname === '/api/auth/login') {
      // Refuse before checking the password: otherwise a locked-out client could keep
      // guessing and a correct guess would still sign in.
      if (await rateLimitExhausted(env, request, 'login', 15 * 60 * 1000, 5)) {
        return json({ message: 'Too many sign-in attempts. Wait 15 minutes before trying again.' }, 429)
      }
      const parsed = await readJson(request)
      if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
      const body = parsed.body
      if (!isRecord(body)) return json({ message: 'Enter your username or email and password.' }, 400)
      const identifier = typeof body.usernameOrEmail === 'string'
        ? body.usernameOrEmail.trim().toLowerCase()
        : typeof body.username === 'string'
          ? body.username.trim().toLowerCase()
          : typeof body.email === 'string'
            ? body.email.trim().toLowerCase()
            : ''
      const password = typeof body.password === 'string' ? body.password : ''
      if (!identifier || !password || encoder.encode(password).length > 72) {
        return json({ message: 'Enter your username or email and password.' }, 400)
      }
      const isEmail = identifier.includes('@')
      const user = await env.DB.prepare(`
        SELECT id, full_name, email, username, password_hash, role
        FROM users WHERE ${isEmail ? 'email' : 'username'} = ? LIMIT 1
      `).bind(identifier).first<UserRow>()
      if (!user || !await verifyPassword(password, user.password_hash)) {
        if (!await limited(env, request, 'login', 15 * 60 * 1000, 5)) {
          return json({ message: 'Too many sign-in attempts. Wait 15 minutes before trying again.' }, 429)
        }
        return json({ message: 'The username/email or password is incorrect.' }, 401)
      }
      const publicProfile = publicUser(user)
      return json({ user: publicProfile, token: await signToken(publicProfile, env.JWT_SECRET!) })
    }

    if (method === 'POST' && pathname === '/api/auth/logout') return new Response(null, { status: 204 })

    const auth = await authenticatedUser(request, env)
    if (pathname === '/api/auth/me' && method === 'GET') {
      if (!auth) return json({ message: 'Please sign in to continue.' }, 401)
      return json({ user: auth })
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
      if (!auth) return json({ message: 'Please sign in to continue.' }, 401)
      if (auth.role !== 'ADMIN') return json({ message: 'Admin access requires an administrator account.' }, 403)
      return json({ user: auth })
    }

    const needsAuth = pathname.startsWith('/api/bookings') ||
      pathname.startsWith('/api/admin/') ||
      pathname === '/api/payments/create-gcash-checkout'
    if (needsAuth && !auth) return json({ message: 'Please sign in to continue.' }, 401)
    if (pathname.startsWith('/api/admin/') && auth?.role !== 'ADMIN') {
      return json({ message: 'Admin access requires an administrator account.' }, 403)
    }

    if (method === 'POST' && pathname === '/api/bookings' && auth) {
      return createBooking(request, env, auth)
    }
    if (method === 'POST' && pathname === '/api/payments/create-gcash-checkout' && auth) {
      if (!await limited(env, request, 'gcash-checkout', 60 * 60 * 1000, 20)) {
        return json({ message: 'Too many checkout attempts. Please try again later.' }, 429)
      }
      return createGcashCheckout(request, env, auth)
    }
    if (method === 'POST' && pathname === '/api/bookings/pending-hold' && auth) {
      if (!await limited(env, request, 'pending-hold', 60 * 60 * 1000, 10)) {
        return json({ message: 'Too many hold requests. Please try again later.' }, 429)
      }
      return createPendingHold(request, env, auth)
    }
    if (method === 'GET' && pathname === '/api/bookings/mine' && auth) {
      await expirePendingHolds(env)
      return json({ bookings: await loadBookings(env, auth.id) })
    }
    const submitId = getPathId(pathname, /^\/api\/bookings\/([^/]+)\/payment-proof$/)
    if (method === 'POST' && submitId && auth) return submitPaymentProof(request, env, auth, submitId)

    if (method === 'GET' && pathname === '/api/admin/bookings' && auth?.role === 'ADMIN') {
      await expirePendingHolds(env)
      return json({ bookings: await loadBookings(env) })
    }

    if (method === 'GET' && pathname === '/api/admin/users' && auth?.role === 'ADMIN') {
      return adminUsers(env)
    }
    const removeUserId = getPathId(pathname, /^\/api\/admin\/users\/([^/]+)$/)
    if (method === 'DELETE' && removeUserId && auth?.role === 'ADMIN') {
      return removeUser(env, auth, removeUserId, new URL(request.url).searchParams.get('purgeBookings') === 'true')
    }
    if (method === 'GET' && pathname === '/api/admin/blocked-dates' && auth?.role === 'ADMIN') {
      return listBlockedDates(env)
    }
    if (method === 'POST' && pathname === '/api/admin/blocked-dates' && auth?.role === 'ADMIN') {
      return addBlockedDate(request, env, auth)
    }
    const blockId = getPathId(pathname, /^\/api\/admin\/blocked-dates\/([^/]+)$/)
    if (method === 'DELETE' && blockId && auth?.role === 'ADMIN') {
      const result = await env.DB.prepare('DELETE FROM blocked_dates WHERE id = ?').bind(blockId).run()
      if (!result.meta.changes) return json({ message: 'Blocked dates not found.' }, 404)
      return new Response(null, { status: 204 })
    }
    const rescheduleId = getPathId(pathname, /^\/api\/admin\/bookings\/([^/]+)\/reschedule$/)
    if (method === 'PATCH' && rescheduleId && auth?.role === 'ADMIN') {
      return rescheduleBooking(request, env, rescheduleId)
    }

    const holdBookingId = getPathId(pathname, /^\/api\/admin\/bookings\/([^/]+)\/confirm-hold-cash$/)
    if (method === 'POST' && holdBookingId && auth?.role === 'ADMIN') {
      return confirmHoldWithCash(env, holdBookingId)
    }

    if (method === 'POST' && pathname === '/api/admin/bookings/walk-in' && auth?.role === 'ADMIN') {
      return createWalkInCashBooking(request, env, auth)
    }

    const bookingId = getPathId(pathname, /^\/api\/admin\/bookings\/([^/]+)$/)
    if (method === 'PATCH' && bookingId && auth?.role === 'ADMIN') {
      const parsed = await readJson(request)
      if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
      const body = parsed.body
      if (!isRecord(body) || !bookingStatuses.includes(body.status as BookingStatus) || body.status === 'CONFIRMED') {
        return json({ message: 'Bookings are confirmed only after a payment is verified. You can cancel a booking here.' }, 400)
      }
      const result = await env.DB.prepare('UPDATE bookings SET status = ? WHERE id = ?')
        .bind(body.status, bookingId).run()
      if (!result.meta.changes) return json({ message: 'Booking not found.' }, 404)
      return json({ message: 'Booking updated.' })
    }

    const cashBookingId = getPathId(pathname, /^\/api\/admin\/bookings\/([^/]+)\/payments\/cash$/)
    if (method === 'POST' && cashBookingId && auth?.role === 'ADMIN') {
      const parsed = await readJson(request)
      if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
      const body = parsed.body
      const amount = isRecord(body) ? body.amount : undefined
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
        return json({ message: 'Enter a valid cash payment amount.' }, 400)
      }
      const result = await recordCashPayment(env, cashBookingId, amount)
      if (!result) {
        return json({ message: 'Cash cannot be recorded while a payment is under review, or the amount exceeds the remaining balance.' }, 409)
      }
      if (result === 'DATE_UNAVAILABLE') {
        return json({
          message: 'Cash was received and recorded, but these dates were already secured by an earlier-verified booking. The booking is marked date unavailable and requires customer contact/refund follow-up.',
          dateUnavailable: true,
        }, 201)
      }
      return json({ message: 'Cash payment recorded as received.' }, 201)
    }

    const paymentIdMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/payments\/([^/]+)$/)
    if (method === 'PATCH' && paymentIdMatch && auth?.role === 'ADMIN') {
      let id: string
      let paymentId: string
      try {
        id = decodeURIComponent(paymentIdMatch[1])
        paymentId = decodeURIComponent(paymentIdMatch[2])
      } catch {
        return json({ message: 'A valid booking and payment ID are required.' }, 400)
      }
      const parsed = await readJson(request)
      if (parsed.tooLarge) return json({ message: 'Request body must be 10 KB or smaller.' }, 413)
      const body = parsed.body
      if (!isRecord(body) || typeof body.received !== 'boolean') return json({ message: 'Choose whether the payment was received.' }, 400)
      const updated = await reviewPayment(env, id, paymentId, body.received)
      if (!updated) return json({ message: 'This payment is no longer waiting for review.' }, 409)
      if (updated === 'DATE_UNAVAILABLE') {
        return json({
          message: 'Payment received and recorded, but these dates were already secured by an earlier-verified booking. The booking is marked date unavailable and requires customer contact/refund follow-up.',
          dateUnavailable: true,
        })
      }
      return json({ message: body.received ? 'Payment confirmed as received.' : 'Payment marked as not received.' })
    }

    const proofMatch = pathname.match(/^\/api\/admin\/bookings\/([^/]+)\/payments\/([^/]+)\/proof$/)
    if (method === 'GET' && proofMatch && auth?.role === 'ADMIN') {
      let id: string
      let paymentId: string
      try {
        id = decodeURIComponent(proofMatch[1])
        paymentId = decodeURIComponent(proofMatch[2])
      } catch {
        return json({ message: 'A valid booking and payment ID are required.' }, 400)
      }
      const payment = await env.DB.prepare(`
        SELECT proof_storage_key, proof_file_name FROM booking_payments WHERE booking_id = ? AND id = ?
      `).bind(id, paymentId).first<{ proof_storage_key: string | null; proof_file_name: string | null }>()
      if (!payment?.proof_storage_key) return json({ message: 'No payment proof is attached to this booking.' }, 404)
      const object = await env.PAYMENT_PROOFS.get(payment.proof_storage_key)
      if (!object) return json({ message: 'The payment proof could not be found in private storage.' }, 404)
      const filename = (payment.proof_file_name ?? payment.proof_storage_key).replace(/["\\\r\n]/g, '_')
      return new Response(object.body, {
        headers: {
          'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
          'Content-Disposition': `inline; filename="${filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    return json({ message: 'API route not found.' }, 404)
  } catch (error) {
    console.error('Unhandled Cloudflare API error:', error)
    return json({ message: 'The server could not complete the request.' }, 500)
  }
}

export default {
  // Cron trigger (wrangler.jsonc "triggers.crons": every 15 minutes) expires stale holds
  // even when nobody is browsing; reads of bookings/availability also expire them.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(expirePendingHolds(env).then((expired) => {
      if (expired) console.log(`Expired ${expired} unpaid voucher(s) or checkout(s).`)
    }))
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await api(request, env)
    if (response) return response
    const assetResponse = await env.ASSETS.fetch(request)
    const headers = new Headers(assetResponse.headers)
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    })
  },
}
