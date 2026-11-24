import { ArrowUpRight, Clock3, MapPin, Phone } from 'lucide-react'
import { tourDetails, type TourType } from '../data/bookings'
import { RESORT_INFO, phoneLink } from '../data/resortInfo'
import ResortLogo from './ResortLogo'

const TOUR_ORDER: TourType[] = ['DAY_TOUR', 'NIGHT_TOUR', 'OVERNIGHT']

/** Read once when the page loads, for the copyright line. */
const YEAR = new Date().getFullYear()

const LINKS = [
  { href: '#stays', label: 'Stay & unwind' },
  { href: '#booking', label: 'Plan your visit' },
  { href: '#my-inquiry', label: 'My bookings & payments' },
  { href: '#amenities', label: 'Amenities' },
  { href: '#rates', label: 'Rates' },
]

/** Footer: contact, tour hours, booking rules and quick links. */
export default function SiteFooter() {
  const { location, address, phones, hours, facebookUrl, name } = RESORT_INFO

  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-about">
          <a className="brand footer-brand" href="#home" aria-label="Tampisawan home">
            <ResortLogo className="resort-logo-footer" />
          </a>
          <p className="footer-note">Make space for a little getaway.</p>
          {hours && (
            <p className="footer-contact">
              <Clock3 size={16} aria-hidden="true" />
              <span>{hours}</span>
            </p>
          )}
          {phones.length > 0 && (
            <p className="footer-contact">
              <Phone size={16} aria-hidden="true" />
              <span className="footer-phones">
                {phones.map((phone) => <a key={phone} href={phoneLink(phone)}>{phone}</a>)}
              </span>
            </p>
          )}
          {location && (
            <a className="footer-contact" href={location.mapsUrl} target="_blank" rel="noreferrer">
              <MapPin size={16} aria-hidden="true" />
              <span>{address ? address.join(', ') : 'View us on Google Maps'}</span>
            </a>
          )}
          <a className="footer-social" href={facebookUrl} target="_blank" rel="noreferrer">
            Follow us on Facebook <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>

        <nav className="footer-col" aria-label="Footer">
          <h2>Explore</h2>
          <ul>
            {LINKS.map((link) => <li key={link.href}><a href={link.href}>{link.label}</a></li>)}
            {location && <li><a href="#find-us">How to get here</a></li>}
          </ul>
        </nav>

        <div className="footer-col">
          <h2>Tour hours</h2>
          <ul>
            {TOUR_ORDER.map((type) => (
              <li key={type}>
                <b>{tourDetails[type].label}</b>
                <span>{tourDetails[type].checkIn} – {tourDetails[type].checkOut}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer-col">
          <h2>Good to know</h2>
          <ul>
            <li>Pay by GCash. Your dates are secured once the resort verifies your payment.</li>
            <li>No refunds. Date changes are subject to approval.</li>
          </ul>
        </div>
      </div>

      <div className="footer-bottom">
        <span>© {YEAR} {name}</span>
        <a className="footer-top" href="#home">Back to top <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div>
    </footer>
  )
}
