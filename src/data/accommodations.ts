/**
 * A photo of an accommodation, shown in its "View photos" gallery.
 * Put the image files in public/accommodations/<accommodation id>/ (for example
 * public/accommodations/abelyns-cabin-glass/inside-1.jpg) and list them in that
 * accommodation's `photos`. The first photo is also used as the card's cover image.
 */
export interface StayPhoto {
  /** Path under public/, e.g. '/accommodations/abelyns-cabin-glass/inside-1.jpg' */
  src: string
  /** Describes the photo for screen readers, e.g. 'Air-conditioned bedroom with a queen bed' */
  alt: string
  area: 'inside' | 'outside'
  caption?: string
}

export interface Accommodation {
  id: string
  name: string
  category: string
  /** Day Tour / Night Tour rate (one session). */
  baseRate: number
  /** Overnight (22 hours) rate; also charged per day for any booking of 2 or more days. */
  overnightRate: number
  /** Day / Night Tour maximum pax. */
  capacity: number
  /** Overnight maximum pax, when it differs from the Day / Night Tour maximum. */
  overnightCapacity?: number
  features: string[]
  entranceFeeForAll: boolean
  exclusiveWholeResort?: boolean
  accessType: 'EXCLUSIVE_WHOLE_RESORT' | 'SHARED_POOL'
  accessBadge: string
  accessDescription: string
  /** Inside and outside photos; empty until the resort's pictures are added. */
  photos: StayPhoto[]
}

export const accommodations: Accommodation[] = [
  {
    id: 'abelyns-cabin-glass',
    name: "Abelyn's Cabin Glass",
    category: 'Cabin stay',
    baseRate: 6000,
    overnightRate: 7500,
    capacity: 8,
    features: ['Air conditioning', 'Television', 'Comfort room'],
    entranceFeeForAll: false,
    exclusiveWholeResort: true,
    accessType: 'EXCLUSIVE_WHOLE_RESORT',
    accessBadge: 'Exclusive Private Stay',
    accessDescription: 'The resort and pool are private for your group during your dates. Only the room you booked is included; other rooms are not.',
    photos: [],
  },
  {
    id: 'bahay-hapag',
    name: 'Bahay Hapag',
    category: 'Private room',
    baseRate: 2500,
    overnightRate: 3500,
    capacity: 4,
    features: ['Air conditioning', 'Television', 'Refrigerator', 'Comfort room'],
    entranceFeeForAll: false,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Private room with standard shared access to the resort swimming pool and grounds alongside other guests.',
    photos: [],
  },
  {
    id: 'balai-delnor',
    name: 'Balai Delnor',
    category: 'Private stay',
    baseRate: 6500,
    overnightRate: 8000,
    capacity: 12,
    features: ['Air conditioning', 'Television', 'Heater in comfort room', 'Free use of amenities'],
    entranceFeeForAll: false,
    exclusiveWholeResort: true,
    accessType: 'EXCLUSIVE_WHOLE_RESORT',
    accessBadge: 'Exclusive Private Stay',
    accessDescription: 'The resort and pool are private for your group during your dates. Only the room you booked is included; other rooms are not.',
    photos: [],
  },
  {
    id: 'gazebo',
    name: 'Gazebo',
    category: 'Open-air space',
    baseRate: 1000,
    overnightRate: 2000,
    capacity: 6,
    features: ['Open-air gathering space', 'Entrance fee applies to all guests'],
    entranceFeeForAll: true,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Open-air gathering space with standard shared-pool access.',
    photos: [],
  },
  {
    id: 'balay-buknoy',
    name: 'Balay Buknoy',
    category: 'Cabin stay',
    baseRate: 4000,
    overnightRate: 5000,
    capacity: 8,
    features: ['Air conditioning', 'Comfort room'],
    entranceFeeForAll: false,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Air-conditioned cabin stay with standard shared-pool access.',
    photos: [],
  },
  {
    id: 'abelyns-mini-event-area',
    name: "Abelyn's Mini Event Area",
    category: 'Event space',
    baseRate: 2500,
    overnightRate: 3500,
    capacity: 20,
    overnightCapacity: 10,
    features: ['Gathering space', 'Up to 20 guests (10 overnight)'],
    entranceFeeForAll: false,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Event area with standard shared-pool access.',
    photos: [],
  },
  {
    id: 'balai-andeng',
    name: 'Balai Andeng',
    category: 'Cabin stay',
    baseRate: 1200,
    overnightRate: 1500,
    capacity: 2,
    features: ['Air conditioning', 'Comfort room'],
    entranceFeeForAll: false,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Cozy private cabin with standard shared-pool access.',
    photos: [],
  },
  {
    id: 'calesa-tables',
    name: 'Calesa Tables',
    category: 'Outdoor tables',
    baseRate: 500,
    overnightRate: 500,
    capacity: 6,
    features: ['Outdoor table seating', 'Entrance fee applies to all guests'],
    entranceFeeForAll: true,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Outdoor table seating with standard shared-pool access.',
    photos: [],
  },
  {
    id: 'kubo-ni-gerrant',
    name: 'Kubo ni Gerrant',
    category: 'Open-air space',
    baseRate: 1000,
    overnightRate: 1500,
    capacity: 12,
    features: ['Table under the tree', 'Entrance fee applies to all guests', 'Kubo Cottage setting'],
    entranceFeeForAll: true,
    exclusiveWholeResort: false,
    accessType: 'SHARED_POOL',
    accessBadge: 'Standard Shared-Pool Access',
    accessDescription: 'Open-air Kubo Cottage with standard shared access to the resort swimming pool alongside other guests.',
    photos: [],
  },
]
