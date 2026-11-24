import type { Accommodation } from '../data/accommodations'
import type { TourType } from '../data/bookings'

export interface GuestBreakdown {
  adults: number
  seniorsPwd: number
  children: number
}

/** Entrance fee per guest per day, by tour type. */
export const entranceRates: Record<TourType, { adults: number; seniorsPwd: number; children: number }> = {
  DAY_TOUR: { adults: 150, seniorsPwd: 120, children: 120 },
  NIGHT_TOUR: { adults: 250, seniorsPwd: 150, children: 150 },
  OVERNIGHT: { adults: 250, seniorsPwd: 150, children: 150 },
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
export function usesOvernightRates(tourType: TourType, stayDays: number) {
  return tourType === 'OVERNIGHT' || Math.floor(stayDays) > 1
}

/**
 * The accommodations as priced for this booking: `baseRate` and `capacity` become the rate and
 * maximum pax that apply to the chosen tour type and length (safe to apply more than once).
 */
export function priceAccommodations<T extends Accommodation>(stays: T[], tourType: TourType, stayDays: number): T[] {
  if (usesOvernightRates(tourType, stayDays)) {
    return stays.map((stay) => ({ ...stay, baseRate: stay.overnightRate, capacity: stay.overnightCapacity ?? stay.capacity }))
  }
  return stays
}

/**
 * Several accommodations booked together act as one: rates add up, and entrance fees are
 * charged once per guest after their combined included capacity (accommodations that charge
 * every guest include no one). Mirrors server/src/pricing.ts.
 */
export function combineAccommodations(selected: Accommodation[]) {
  return {
    name: selected.map((stay) => stay.name).join(' + '),
    baseRate: selected.reduce((sum, stay) => sum + stay.baseRate, 0),
    capacity: selected.reduce((sum, stay) => sum + (stay.entranceFeeForAll ? 0 : stay.capacity), 0),
    /** The rooms' combined pax (guests above it pay entrance; see BOOKING_MAX_GUESTS). */
    maxGuests: selected.reduce((sum, stay) => sum + stay.capacity, 0),
    entranceFeeForAll: selected.length > 0 && selected.every((stay) => stay.entranceFeeForAll),
    exclusiveWholeResort: selected.some((stay) => stay.exclusiveWholeResort),
  }
}

/**
 * Guests above the rooms' pax are allowed: they pay the entrance fee (both posters). One booking
 * is capped at this many guests. Mirrors server/src/pricing.ts.
 */
export const BOOKING_MAX_GUESTS = 100

/**
 * Price of a booking. Where the rooms include entrance for their pax, the guest fills the pax
 * with their main guests first and adds the rest as `extras` (by type), who pay entrance.
 * Without `extras`, the pax cover children, then seniors/PWD, then adults, so extra heads are
 * charged the adult rate first. Mirrors server/src/pricing.ts.
 */
export function calculateBookingTotal(
  accommodations: Accommodation | Accommodation[],
  guests: GuestBreakdown,
  stayDays = 1,
  tourType: TourType = 'OVERNIGHT',
  extras?: GuestBreakdown | null,
) {
  const billableDays = Math.max(1, Math.floor(stayDays))
  const accommodation = combineAccommodations(
    priceAccommodations(Array.isArray(accommodations) ? accommodations : [accommodations], tourType, billableDays),
  )
  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  let chargeable = { ...guests }

  if (!accommodation.entranceFeeForAll) {
    const extraCount = Math.max(0, guestCount - accommodation.capacity)
    const declared = extras ? extras.adults + extras.seniorsPwd + extras.children : -1
    if (
      extras && declared === extraCount &&
      extras.adults <= guests.adults && extras.seniorsPwd <= guests.seniorsPwd && extras.children <= guests.children
    ) {
      chargeable = { ...extras }
    } else {
      let includedCapacity = Math.min(guestCount, accommodation.capacity)
      const includedChildren = Math.min(chargeable.children, includedCapacity)
      chargeable.children -= includedChildren
      includedCapacity -= includedChildren

      const includedSeniors = Math.min(chargeable.seniorsPwd, includedCapacity)
      chargeable.seniorsPwd -= includedSeniors
      includedCapacity -= includedSeniors

      chargeable.adults -= Math.min(chargeable.adults, includedCapacity)
    }
  }

  const chargeableGuests =
    chargeable.adults + chargeable.seniorsPwd + chargeable.children
  const rates = entranceRates[usesOvernightRates(tourType, billableDays) ? 'OVERNIGHT' : tourType]
  const dailyEntranceFees =
    chargeable.adults * rates.adults +
    chargeable.seniorsPwd * rates.seniorsPwd +
    chargeable.children * rates.children
  const baseRate = accommodation.baseRate * billableDays
  const entranceFees = dailyEntranceFees * billableDays
  const grandTotal = baseRate + entranceFees

  return {
    stayDays: billableDays,
    dailyBaseRate: accommodation.baseRate,
    baseRate,
    /** Pax whose entrance the room rate covers (0 when every guest pays entrance). */
    includedPax: accommodation.entranceFeeForAll ? 0 : accommodation.capacity,
    everyGuestPaysEntrance: accommodation.entranceFeeForAll,
    /** Guests who pay the entrance fee, by type, and the per-guest rate for each type. */
    chargeable,
    entranceRate: rates,
    chargeableGuests,
    dailyEntranceFees,
    entranceFees,
    grandTotal,
    depositRequired: grandTotal * 0.5,
  }
}

export function formatPeso(amount: number) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  }).format(amount)
}
