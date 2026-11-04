export interface Accommodation {
  id: string
  name: string
  category: string
  baseRate: number
  capacity: number
  features: string[]
  entranceFeeForAll: boolean
}

export const accommodations: Accommodation[] = [
  {
    id: 'abelyns-cabin-glass',
    name: "Abelyn's Cabin Glass",
    category: 'Cabin stay',
    baseRate: 6000,
    capacity: 8,
    features: ['Air conditioning', 'Television', 'Comfort room'],
    entranceFeeForAll: false,
  },
  {
    id: 'bahay-hapag',
    name: 'Bahay Hapag',
    category: 'Private room',
    baseRate: 2500,
    capacity: 4,
    features: ['Air conditioning', 'Television', 'Refrigerator', 'Comfort room'],
    entranceFeeForAll: false,
  },
  {
    id: 'balai-delnor',
    name: 'Balai Delnor',
    category: 'Private stay',
    baseRate: 6500,
    capacity: 12,
    features: ['Air conditioning', 'Television', 'Heater in comfort room', 'Free use of amenities'],
    entranceFeeForAll: false,
  },
  {
    id: 'gazebo',
    name: 'Gazebo',
    category: 'Open-air space',
    baseRate: 1000,
    capacity: 6,
    features: ['Open-air gathering space', 'Entrance fee applies to all guests'],
    entranceFeeForAll: true,
  },
  {
    id: 'balay-buknoy',
    name: 'Balay Buknoy',
    category: 'Cabin stay',
    baseRate: 4000,
    capacity: 8,
    features: ['Air conditioning', 'Comfort room'],
    entranceFeeForAll: false,
  },
  {
    id: 'abelyns-mini-event-area',
    name: "Abelyn's Mini Event Area",
    category: 'Event space',
    baseRate: 2500,
    capacity: 20,
    features: ['Gathering space', 'Up to 20 guests'],
    entranceFeeForAll: false,
  },
  {
    id: 'balai-andeng',
    name: 'Balai Andeng',
    category: 'Cabin stay',
    baseRate: 1200,
    capacity: 2,
    features: ['Air conditioning', 'Comfort room'],
    entranceFeeForAll: false,
  },
  {
    id: 'calesa-tables',
    name: 'Calesa Tables',
    category: 'Outdoor tables',
    baseRate: 500,
    capacity: 6,
    features: ['Outdoor table seating', 'Entrance fee applies to all guests'],
    entranceFeeForAll: true,
  },
  {
    id: 'kubo-ni-gerrant',
    name: 'Kubo ni Gerrant',
    category: 'Open-air space',
    baseRate: 1000,
    capacity: 12,
    features: ['Table under the tree', 'Entrance fee applies to all guests'],
    entranceFeeForAll: true,
  },
]
