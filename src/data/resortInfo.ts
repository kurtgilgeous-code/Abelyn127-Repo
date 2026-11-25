/**
 * The resort's public contact details, shown in the "Find us" section and the footer.
 * Leave a value as null (or a list empty) to hide it. "Find us" appears once `location` is set.
 */
export const RESORT_INFO: {
  name: string
  facebookUrl: string
  /** Where the resort is on the map, from its Google Maps listing. */
  location: {
    /** The Google Maps listing (Maps → Share → Copy link). */
    mapsUrl: string
    lat: number
    lng: number
  } | null
  /** Street address as guests should read it, one line per part. Optional: the map shows it too. */
  address: string[] | null
  /** Public phone numbers, written as guests should read them. */
  phones: string[]
  /** Opening hours in a few words. */
  hours: string | null
  /** Short directions, e.g. landmarks to look for. One line per tip. */
  directions: string[]
} = {
  name: "Tampisawan 927 Abelyn's Private Pool",
  facebookUrl: 'https://www.facebook.com/profile.php?id=61553358111597',
  location: {
    mapsUrl: "https://www.google.com/maps/place/Tampisawan+927+Abelyn's+Private+Pool/@13.817892,121.3354079,17z/data=!3m1!4b1!4m6!3m5!1s0x33bd3fc8888c2f2b:0x1e3042b1f41f7515!8m2!3d13.8178868!4d121.3379828!16s%2Fg%2F11vhtxpbff",
    lat: 13.8178868,
    lng: 121.3379828,
  },
  // As written on the resort's Google Maps listing.
  address: ['Sitio Madrecacawan, San Juan', '4226 Batangas'],
  phones: ['+63 977 851 0927', '+63 917 568 7772', '043 783 9882 (landline)'],
  hours: 'Open 24/7',
  directions: [],
}

/** A real photo of the resort: the garden bridge and the sign to every space. */
export const RESORT_PHOTO = { src: '/hero.jpg', small: '/hero-small.jpg' }

/** Phone number as a tel: link, e.g. 0917 123 4567 or +63 917 123 4567 → tel:+639171234567. */
export function phoneLink(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return `tel:${digits.startsWith('0') ? `+63${digits.slice(1)}` : `+${digits}`}`
}

/** Opens Google Maps with directions to the resort's exact pin. */
export function directionsLink(location: { lat: number, lng: number }) {
  return `https://www.google.com/maps/dir/?api=1&destination=${location.lat},${location.lng}`
}
