import { useEffect, useRef, useState } from 'react'
import { Camera, ChevronLeft, ChevronRight, Sparkles, Users, Waves, X } from 'lucide-react'
import type { Accommodation, StayPhoto } from '../data/accommodations'
import './StayGallery.css'

type Area = 'all' | StayPhoto['area']

const areaLabels: Record<Area, string> = { all: 'All photos', inside: 'Inside', outside: 'Outside' }

/** Full-screen photo viewer for one accommodation: inside / outside tabs, arrows, swipe, keyboard. */
export default function StayGallery({ stay, onClose }: { stay: Accommodation, onClose: () => void }) {
  const [area, setArea] = useState<Area>('all')
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState<Record<string, boolean>>({})
  const closeRef = useRef<HTMLButtonElement>(null)
  const thumbsRef = useRef<HTMLDivElement>(null)
  const swipeStart = useRef<number | null>(null)

  const photos = area === 'all' ? stay.photos : stay.photos.filter((photo) => photo.area === area)
  const current = photos[Math.min(index, photos.length - 1)]
  const count = (value: Area) => (value === 'all' ? stay.photos.length : stay.photos.filter((photo) => photo.area === value).length)

  const go = (step: number) => {
    if (photos.length < 2) return
    setIndex((value) => (value + step + photos.length) % photos.length)
  }

  // Focus the dialog, lock page scrolling, and return focus to the opener on close.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') go(1)
      else if (event.key === 'ArrowLeft') go(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Keep the active thumbnail in view.
  useEffect(() => {
    thumbsRef.current?.querySelector<HTMLElement>('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [index, area])

  return (
    <div className="gallery-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="gallery-dialog" role="dialog" aria-modal="true" aria-labelledby="gallery-title">
        <header className="gallery-header">
          <div>
            <span className="gallery-eyebrow">
              {stay.exclusiveWholeResort ? <><Sparkles size={12} /> Exclusive / solo use</> : <><Waves size={12} /> Shared pool access</>}
            </span>
            <h2 id="gallery-title">{stay.name}</h2>
            <p>{stay.category} · <Users size={12} aria-hidden="true" /> Up to {stay.capacity} pax</p>
          </div>
          <button ref={closeRef} type="button" className="gallery-close" aria-label="Close photos" onClick={onClose}><X size={18} /></button>
        </header>

        {stay.photos.length > 0 && (
          <div className="gallery-tabs" role="tablist" aria-label="Photo area">
            {(['all', 'inside', 'outside'] as Area[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={area === value}
                className={area === value ? 'is-active' : ''}
                disabled={count(value) === 0}
                onClick={() => { setArea(value); setIndex(0) }}
              >
                {areaLabels[value]} <span>{count(value)}</span>
              </button>
            ))}
          </div>
        )}

        {current ? (
          <>
            <figure
              className="gallery-stage"
              onPointerDown={(event) => { swipeStart.current = event.clientX }}
              onPointerUp={(event) => {
                if (swipeStart.current === null) return
                const delta = event.clientX - swipeStart.current
                swipeStart.current = null
                if (Math.abs(delta) > 40) go(delta < 0 ? 1 : -1)
              }}
            >
              {!loaded[current.src] && <span className="gallery-loading" aria-hidden="true" />}
              <img
                key={current.src}
                src={current.src}
                alt={current.alt}
                className={loaded[current.src] ? 'is-loaded' : ''}
                onLoad={() => setLoaded((value) => ({ ...value, [current.src]: true }))}
                draggable={false}
              />
              {photos.length > 1 && (
                <>
                  <button type="button" className="gallery-arrow is-prev" aria-label="Previous photo" onClick={() => go(-1)}><ChevronLeft size={22} /></button>
                  <button type="button" className="gallery-arrow is-next" aria-label="Next photo" onClick={() => go(1)}><ChevronRight size={22} /></button>
                </>
              )}
              <figcaption>
                <span className={`gallery-area-pill is-${current.area}`}>{current.area === 'inside' ? 'Inside' : 'Outside'}</span>
                {current.caption ?? current.alt}
                <span className="gallery-counter" aria-live="polite">{Math.min(index, photos.length - 1) + 1} / {photos.length}</span>
              </figcaption>
            </figure>
            {photos.length > 1 && (
              <div className="gallery-thumbs" ref={thumbsRef}>
                {photos.map((photo, photoIndex) => (
                  <button
                    key={photo.src}
                    type="button"
                    aria-label={`Show photo ${photoIndex + 1}: ${photo.alt}`}
                    aria-current={photoIndex === index}
                    onClick={() => setIndex(photoIndex)}
                  >
                    <img src={photo.src} alt="" loading="lazy" decoding="async" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="gallery-empty">
            <span><Camera size={26} /></span>
            <b>Photos coming soon</b>
            <p>We&apos;re preparing inside and outside photos of {stay.name}. In the meantime, ask Geraint or message the resort for a closer look.</p>
          </div>
        )}
      </section>
    </div>
  )
}
