import { ArrowUpRight, Clock3, MapPin, MessageCircle, Navigation, Phone } from 'lucide-react'
import { RESORT_INFO, directionsLink, phoneLink } from '../data/resortInfo'

/** Where the resort is: name, hours, phones, a map and a directions button. */
export default function FindUs() {
  const { name, location, address, phones, hours, directions, facebookUrl } = RESORT_INFO
  if (!location) return null

  // Searching the listing's name near its pin shows the resort's own card on the map.
  const mapSrc = `https://www.google.com/maps?q=${encodeURIComponent(name)}&ll=${location.lat},${location.lng}&z=16&output=embed`

  return (
    <section className="find-us section-wrap" id="find-us" aria-labelledby="find-us-title">
      <div className="find-us-copy" data-aos="fade-up">
        <span className="eyebrow eyebrow-dark"><span className="eyebrow-dot" /> HOW TO GET HERE</span>
        <h2 id="find-us-title">Find your way <em>to the water.</em></h2>

        <address className="find-us-details">
          <a className="find-us-line" href={location.mapsUrl} target="_blank" rel="noreferrer">
            <MapPin size={18} aria-hidden="true" />
            <span>
              <span>{name}</span>
              {address?.map((line) => <span key={line} className="find-us-sub">{line}</span>)}
              <span className="find-us-sub">View on Google Maps <ArrowUpRight size={13} aria-hidden="true" /></span>
            </span>
          </a>

          {hours && (
            <p className="find-us-line">
              <Clock3 size={18} aria-hidden="true" />
              <span>{hours}</span>
            </p>
          )}

          {phones.length > 0 && (
            <p className="find-us-line">
              <Phone size={18} aria-hidden="true" />
              <span className="find-us-phones">
                {phones.map((phone) => <a key={phone} href={phoneLink(phone)}>{phone}</a>)}
              </span>
            </p>
          )}
        </address>

        {directions.length > 0 && (
          <ul className="find-us-tips">
            {directions.map((tip) => <li key={tip}>{tip}</li>)}
          </ul>
        )}

        <div className="find-us-actions">
          <a className="find-us-primary" href={directionsLink(location)} target="_blank" rel="noreferrer">
            <Navigation size={16} aria-hidden="true" /> Get directions
          </a>
          <a className="find-us-secondary" href={facebookUrl} target="_blank" rel="noreferrer">
            <MessageCircle size={16} aria-hidden="true" /> Message us <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="find-us-map" data-aos="fade-up" data-aos-delay="100">
        <iframe
          title={`Map showing ${name}`}
          src={mapSrc}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </section>
  )
}
