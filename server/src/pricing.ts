import type { TourType } from './db.js'

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

export const wholeResortAccommodationIds = Object.entries(rates)
  .filter(([, accommodation]) => accommodation.exclusiveWholeResort)
  .map(([id]) => id)

const entranceRates: Record<TourType, { adults: number; seniorsPwd: number; children: number }> = {
  DAY_TOUR: { adults: 150, seniorsPwd: 120, children: 120 },
  NIGHT_TOUR: { adults: 250, seniorsPwd: 150, children: 150 },
  OVERNIGHT: { adults: 250, seniorsPwd: 150, children: 150 },
}

export function isKnownAccommodation(accommodationId: string) {
  return Object.prototype.hasOwnProperty.call(rates, accommodationId)
}

const accommodationOrder = Object.keys(rates)
export const MAX_ACCOMMODATIONS_PER_BOOKING = accommodationOrder.length

/**
 * Reads the accommodations of a booking request: `accommodationIds` (a list, so one booking
 * can combine e.g. Bahay Hapag + Balai Delnor), or the older single `accommodationId`.
 * Returns the IDs de-duplicated in the resort's listing order, or null if any is unknown.
 */
export function parseAccommodationIds(body: unknown): string[] | null {
  if (typeof body !== 'object' || body === null) return null
  const record = body as { accommodationIds?: unknown, accommodationId?: unknown }
  const raw = Array.isArray(record.accommodationIds)
    ? record.accommodationIds
    : typeof record.accommodationId === 'string' ? [record.accommodationId] : null
  if (!raw || raw.length === 0 || raw.length > MAX_ACCOMMODATIONS_PER_BOOKING) return null
  if (!raw.every((id): id is string => typeof id === 'string' && isKnownAccommodation(id))) return null
  return normalizeAccommodationIds(raw)
}

export function normalizeAccommodationIds(ids: string[]) {
  return [...new Set(ids)].sort((a, b) => accommodationOrder.indexOf(a) - accommodationOrder.indexOf(b))
}

/**
 * Two posters set the prices (mirrors src/utils/pricing.ts):
 * - Day Tour and Night Tour (one day): the Day/Night room rate, with that tour's entrance
 *   included up to the rooms' pax (Abelyn's Cabin Glass: ₱6,000 covers 8 guests); extra heads
 *   pay entrance (Day ₱150 / ₱120, Night ₱250 / ₱150).
 * - Overnight (22 hours), also used for every booking of 2 or more days: the overnight rate per
 *   day (Abelyn's Cabin Glass for 3 days is 3 × ₱7,500), entrance included up to the pax.
 * Where pax are included, Gazebo, Calesa Tables, and Kubo ni Gerrant still charge every guest.
 */
export function usesOvernightRates(tourType: unknown, days: number) {
  return tourType === 'OVERNIGHT' || days > 1
}

/**
 * Guests above the rooms' pax are allowed: they pay the entrance fee (both posters). One booking
 * is capped at this many guests so a typo or abuse can't create an absurd booking.
 */
export const BOOKING_MAX_GUESTS = 100

/** A guest-facing message if the request has more guests than one booking allows. */
export function guestLimitMessage(body: unknown) {
  const guests = (body as { guests?: Record<string, unknown> } | null)?.guests
  if (typeof guests !== 'object' || guests === null) return null
  const count = ['adults', 'seniorsPwd', 'children']
    .reduce((sum, key) => sum + (Number.isInteger(guests[key]) ? Number(guests[key]) : 0), 0)
  return count > BOOKING_MAX_GUESTS
    ? `One booking can have up to ${BOOKING_MAX_GUESTS} guests. For a bigger group, please contact the resort.`
    : null
}

export function accommodationNames(ids: string[]) {
  return ids.map((id) => rates[id]?.name ?? id).join(' + ')
}

export type GuestCounts = { adults: number; seniorsPwd: number; children: number }

/**
 * Reads the optional `extraGuests` of a booking request: the guests, by type, that the customer
 * added beyond the room's pax. Returns undefined when absent, null when malformed.
 */
export function parseExtraGuests(body: unknown): GuestCounts | undefined | null {
  if (typeof body !== 'object' || body === null || !('extraGuests' in body)) return undefined
  const extras = (body as { extraGuests?: unknown }).extraGuests
  if (extras === undefined || extras === null) return undefined
  if (typeof extras !== 'object') return null
  const record = extras as Record<string, unknown>
  const counts = { adults: record.adults, seniorsPwd: record.seniorsPwd, children: record.children }
  return Object.values(counts).every((value) => typeof value === 'number' && Number.isInteger(value) && value >= 0)
    ? counts as GuestCounts
    : null
}

/** A booking row's stored `extra_guests` JSON, or null (older bookings, or every guest pays). */
export function parseStoredExtraGuests(stored: string | null | undefined): GuestCounts | null {
  if (!stored) return null
  try {
    const parsed = parseExtraGuests({ extraGuests: JSON.parse(stored) })
    return parsed ?? null
  } catch {
    return null
  }
}

/**
 * Price of one booking that may combine several accommodations. Accommodation rates add up.
 * Where the rooms include entrance for their pax, the customer fills the pax with their main
 * guests first and declares the rest as `extras` (by type), who pay the entrance fee. Without a
 * declaration (older clients, the admin walk-in), the pax cover children, then seniors/PWD, then
 * adults, so extra heads are charged the adult rate first. Returns null if invalid.
 */
export function calculateServerBookingTotal(
  accommodationIds: string | string[],
  tourType: TourType,
  guests: GuestCounts,
  days: number,
  extras?: GuestCounts,
) {
  const ids = normalizeAccommodationIds(Array.isArray(accommodationIds) ? accommodationIds : [accommodationIds])
  const selected = ids.map((id) => rates[id])
  if (selected.length === 0 || selected.some((accommodation) => !accommodation)) return null
  const overnight = usesOvernightRates(tourType, days)
  const accommodation = {
    baseRate: selected.reduce((sum, item) => sum + (overnight ? item.overnightRate : item.baseRate), 0),
    capacity: selected.reduce((sum, item) => sum + (item.entranceFeeForAll ? 0 : overnight ? item.overnightCapacity ?? item.capacity : item.capacity), 0),
    // Entrance is included up to the pax, except where an accommodation charges every guest.
    entranceFeeForAll: selected.every((item) => item.entranceFeeForAll),
    name: accommodationNames(ids),
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
  const dailyEntranceFees =
    chargeable.adults * entranceRate.adults +
    chargeable.seniorsPwd * entranceRate.seniorsPwd +
    chargeable.children * entranceRate.children
  const total = (accommodation.baseRate + dailyEntranceFees) * days
  return {
    total,
    deposit: total * 0.5,
    accommodationName: accommodation.name,
    accommodationIds: ids,
    /** Guests beyond the rooms' pax, by type (null when every guest pays entrance). */
    extraGuests: accommodation.entranceFeeForAll ? null : chargeable,
  }
}
