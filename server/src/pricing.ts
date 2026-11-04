import type { TourType } from './db.js'

const rates: Record<string, { name: string; baseRate: number; capacity: number; entranceFeeForAll: boolean }> = {
  'abelyns-cabin-glass': { name: "Abelyn's Cabin Glass", baseRate: 6000, capacity: 8, entranceFeeForAll: false },
  'bahay-hapag': { name: 'Bahay Hapag', baseRate: 2500, capacity: 4, entranceFeeForAll: false },
  'balai-delnor': { name: 'Balai Delnor', baseRate: 6500, capacity: 12, entranceFeeForAll: false },
  gazebo: { name: 'Gazebo', baseRate: 1000, capacity: 6, entranceFeeForAll: true },
  'balay-buknoy': { name: 'Balay Buknoy', baseRate: 4000, capacity: 8, entranceFeeForAll: false },
  'abelyns-mini-event-area': { name: "Abelyn's Mini Event Area", baseRate: 2500, capacity: 20, entranceFeeForAll: false },
  'balai-andeng': { name: 'Balai Andeng', baseRate: 1200, capacity: 2, entranceFeeForAll: false },
  'calesa-tables': { name: 'Calesa Tables', baseRate: 500, capacity: 6, entranceFeeForAll: true },
  'kubo-ni-gerrant': { name: 'Kubo ni Gerrant', baseRate: 1000, capacity: 12, entranceFeeForAll: true },
}

const entranceRates: Record<TourType, { adults: number; seniorsPwd: number; children: number }> = {
  DAY_TOUR: { adults: 150, seniorsPwd: 120, children: 120 },
  NIGHT_TOUR: { adults: 250, seniorsPwd: 150, children: 150 },
  OVERNIGHT: { adults: 250, seniorsPwd: 150, children: 150 },
}

export function calculateServerBookingTotal(
  accommodationId: string,
  tourType: TourType,
  guests: { adults: number; seniorsPwd: number; children: number },
  days: number,
) {
  const accommodation = rates[accommodationId]
  if (!accommodation) return null

  const guestCount = guests.adults + guests.seniorsPwd + guests.children
  let chargeable = { ...guests }
  if (!accommodation.entranceFeeForAll) {
    let remainingCapacity = Math.min(guestCount, accommodation.capacity)
    const includedAdults = Math.min(chargeable.adults, remainingCapacity)
    chargeable.adults -= includedAdults
    remainingCapacity -= includedAdults
    const includedSeniors = Math.min(chargeable.seniorsPwd, remainingCapacity)
    chargeable.seniorsPwd -= includedSeniors
    remainingCapacity -= includedSeniors
    const includedChildren = Math.min(chargeable.children, remainingCapacity)
    chargeable.children -= includedChildren
  }

  const entranceRate = entranceRates[tourType]
  const dailyEntranceFees =
    chargeable.adults * entranceRate.adults +
    chargeable.seniorsPwd * entranceRate.seniorsPwd +
    chargeable.children * entranceRate.children
  const total = (accommodation.baseRate + dailyEntranceFees) * days
  return {
    total,
    deposit: total * 0.5,
    accommodationName: accommodation.name,
  }
}
