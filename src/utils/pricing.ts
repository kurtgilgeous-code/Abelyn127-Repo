import type { Accommodation } from '../data/accommodations'
import type { TourType } from '../data/bookings'

export interface GuestBreakdown {
  adults: number
  seniorsPwd: number
  children: number
}

const entranceRates: Record<TourType, { adults: number; seniorsPwd: number; children: number }> = {
  DAY_TOUR: { adults: 150, seniorsPwd: 120, children: 120 },
  NIGHT_TOUR: { adults: 250, seniorsPwd: 150, children: 150 },
  OVERNIGHT: { adults: 250, seniorsPwd: 150, children: 150 },
}

export function calculateBookingTotal(
  accommodation: Accommodation,
  guests: GuestBreakdown,
  stayDays = 1,
  tourType: TourType = 'OVERNIGHT',
) {
  const billableDays = Math.max(1, Math.floor(stayDays))
  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  let chargeable = { ...guests }

  if (!accommodation.entranceFeeForAll) {
    let includedCapacity = Math.min(guestCount, accommodation.capacity)
    const includedAdults = Math.min(chargeable.adults, includedCapacity)
    chargeable.adults -= includedAdults
    includedCapacity -= includedAdults

    const includedSeniors = Math.min(chargeable.seniorsPwd, includedCapacity)
    chargeable.seniorsPwd -= includedSeniors
    includedCapacity -= includedSeniors

    const includedChildren = Math.min(chargeable.children, includedCapacity)
    chargeable.children -= includedChildren
  }

  const chargeableGuests =
    chargeable.adults + chargeable.seniorsPwd + chargeable.children
  const rates = entranceRates[tourType]
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
