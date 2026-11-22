import { BedDouble, CalendarCheck, House, type LucideIcon, ReceiptText, Tag, Waves } from 'lucide-react'

/** Side menu links, in the same order as their sections on the page. */
export const sideNavSections: { id: string, label: string, icon: LucideIcon }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'stays', label: 'Stay & unwind', icon: BedDouble },
  { id: 'booking', label: 'Plan your visit', icon: CalendarCheck },
  { id: 'my-inquiry', label: 'My bookings & payments', icon: ReceiptText },
  { id: 'amenities', label: 'Amenities', icon: Waves },
  { id: 'rates', label: 'Rates', icon: Tag },
]

/** Where each section's links land: its heading or form, not the empty space above it. */
export const sectionLandings: Record<string, string> = {
  stays: '.section-heading',
  booking: '#booking-form',
  'my-inquiry': '.customer-followup-copy',
  amenities: '.amenities-copy',
  rates: '.rates-inner',
}
