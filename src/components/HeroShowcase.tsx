import { type CSSProperties, useEffect, useState } from 'react'
import { ArrowRight, Clock3, MapPin, Moon, Pause, Play, ShieldCheck, Sparkles, Users, Waves } from 'lucide-react'
import { type Accommodation, accommodations } from '../data/accommodations'
import './HeroShowcase.css'

/** How long each slide stays up, in milliseconds. */
const SLIDE_MS = 4000

/** Rooms featured in the hero, in order. Kubo ni Gerrant is the resort's Kubo Cottage. */
const FEATURED_IDS = ['abelyns-cabin-glass', 'balai-delnor', 'bahay-hapag', 'kubo-ni-gerrant'] as const

/** Illustrated twilight scene shown until a room has real photos. */
const SCENES: Record<string, 'aframe' | 'balai' | 'bahay' | 'kubo'> = {
  'abelyns-cabin-glass': 'aframe',
  'balai-delnor': 'balai',
  'bahay-hapag': 'bahay',
  'kubo-ni-gerrant': 'kubo',
}

type Slide =
  | { kind: 'room', key: string, stay: Accommodation }
  | { kind: 'pool', key: 'private-pool' }

const slides: Slide[] = [
  ...FEATURED_IDS
    .map((id) => accommodations.find((stay) => stay.id === id))
    .filter((stay): stay is Accommodation => Boolean(stay))
    .map((stay) => ({ kind: 'room' as const, key: stay.id, stay })),
  { kind: 'pool', key: 'private-pool' },
]

const isOpenAir = (stay: Accommodation) => /open-air|outdoor|event/i.test(stay.category)

function durationLabel(stay: Accommodation) {
  return isOpenAir(stay) ? 'Day & Night Tours' : '22 Hours Overnight'
}

function highlight(stay: Accommodation) {
  const extras = stay.features.filter((feature) => !/entrance fee/i.test(feature)).slice(0, 2)
  return [stay.category, ...extras].join(' · ')
}

function slideName(slide: Slide) {
  return slide.kind === 'room' ? slide.stay.name : 'The Private Pool'
}

function RoomScene({ stay }: { stay: Accommodation }) {
  const photo = stay.photos.find((item) => item.area === 'outside') ?? stay.photos[0]
  if (photo) return <img className="showcase-photo" src={photo.src} alt={photo.alt} decoding="async" />
  const scene = SCENES[stay.id] ?? 'bahay'
  return (
    <div className={`showcase-scene scene-${scene}`} role="img" aria-label={`Illustration of ${stay.name} at twilight (photos coming soon)`}>
      <span className="scene-stars" />
      <span className="scene-moon" />
      <span className="scene-hills" />
      <span className="scene-building">
        <span className="scene-roof" />
        <span className="scene-body"><span className="scene-windows" /></span>
        {scene === 'kubo' && <span className="scene-stilts" />}
      </span>
      <span className="scene-lantern scene-lantern-left" />
      <span className="scene-lantern scene-lantern-right" />
      <span className="scene-water"><i /><i /><i /></span>
    </div>
  )
}

function PoolScene() {
  return (
    <div className="hero-art showcase-pool-art" aria-label="Illustration of the private pool at twilight" role="img">
      <div className="art-sky-glow" />
      <div className="art-sun" />
      <div className="art-hill art-hill-back" />
      <div className="art-hill art-hill-front" />
      <div className="art-palm palm-one"><i /><i /><i /><i /><b /></div>
      <div className="art-palm palm-two"><i /><i /><i /><i /><b /></div>
      <div className="art-lantern lantern-one" />
      <div className="art-lantern lantern-two" />
      <div className="art-pool"><span /><i className="art-shimmer shimmer-one" /><i className="art-shimmer shimmer-two" /><i className="art-shimmer shimmer-three" /></div>
    </div>
  )
}

interface HeroShowcaseProps {
  /** Pick this accommodation in the booking calculator and scroll to it. */
  onSelectStay: (stayId: string) => void
  /** Scroll to the booking calculator without changing the selection. */
  onPlanVisit: () => void
}

/**
 * Hero slideshow: a new room every 4 seconds, crossfading with a slow zoom. It keeps
 * playing under the mouse; the dots jump to a slide (restarting the 4 s timer). It stops
 * while the tab is hidden, when the visitor presses pause, and for visitors who prefer
 * reduced motion (they can still use the dots).
 */
export default function HeroShowcase({ onSelectStay, onPlanVisit }: HeroShowcaseProps) {
  const [index, setIndex] = useState(0)
  const [cycle, setCycle] = useState(0)
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [tabHidden, setTabHidden] = useState(() => document.hidden)

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const running = !paused && !tabHidden
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => setIndex((current) => (current + 1) % slides.length), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [index, cycle, running])

  const goTo = (next: number) => {
    setIndex(next)
    setCycle((value) => value + 1)
  }

  return (
    <div className="hero-showcase" data-aos="zoom-in" data-aos-delay="150">
      <div
        className={`showcase-stage ${running ? 'is-running' : 'is-paused'}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="Featured stays at Tampisawan"
        style={{ '--slide-ms': `${SLIDE_MS}ms` } as CSSProperties}
      >
        <div className="showcase-slides" aria-live={running ? 'off' : 'polite'}>
          {slides.map((slide, slideIndex) => {
            const active = slideIndex === index
            return (
              <div
                className={`showcase-slide ${active ? 'is-active' : ''}`}
                key={slide.key}
                role="group"
                aria-roledescription="slide"
                aria-label={`${slideIndex + 1} of ${slides.length}: ${slideName(slide)}`}
                aria-hidden={!active}
                inert={!active}
              >
                <div className="showcase-media">
                  {slide.kind === 'room' ? <RoomScene stay={slide.stay} /> : <PoolScene />}
                </div>
                <div className="showcase-shade" />

                {slide.kind === 'room' ? (
                  <>
                    <span className="showcase-pill showcase-pill-duration">
                      {isOpenAir(slide.stay) ? <Clock3 size={13} aria-hidden="true" /> : <Moon size={13} aria-hidden="true" />}
                      {durationLabel(slide.stay)}
                    </span>
                    {slide.stay.exclusiveWholeResort ? (
                      <span className="showcase-pill showcase-pill-tier is-gold"><Sparkles size={12} aria-hidden="true" /> Exclusive Solo Resort</span>
                    ) : (
                      <span className="showcase-pill showcase-pill-tier is-cobalt"><Waves size={12} aria-hidden="true" /> Shared Pool Access</span>
                    )}
                    <div className="showcase-info">
                      <h3>{slide.stay.name}</h3>
                      <p>{highlight(slide.stay)}</p>
                      <div className="showcase-info-row">
                        <span className="showcase-capacity"><Users size={13} aria-hidden="true" /> Up to {slide.stay.capacity} Pax</span>
                        <button type="button" className="showcase-select" onClick={() => onSelectStay(slide.stay.id)}>
                          Select space <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="showcase-pill showcase-pill-duration"><Clock3 size={13} aria-hidden="true" /> Day, Night &amp; Overnight</span>
                    <span className="showcase-pill showcase-pill-tier is-gold"><ShieldCheck size={12} aria-hidden="true" /> Private Pool</span>
                    <div className="showcase-info">
                      <h3>The Private Pool</h3>
                      <p><MapPin size={12} aria-hidden="true" /> A little place to feel away · day swims to night swims</p>
                      <div className="showcase-info-row">
                        <span className="showcase-capacity"><Waves size={13} aria-hidden="true" /> Included with every stay</span>
                        <button type="button" className="showcase-select" onClick={onPlanVisit}>
                          Plan your visit <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="showcase-controls">
          <div className="showcase-dots" role="group" aria-label="Choose a stay to show">
            {slides.map((slide, slideIndex) => (
              <button
                type="button"
                key={slide.key}
                className={`showcase-dot ${slideIndex === index ? 'is-active' : ''}`}
                aria-label={`Show ${slideName(slide)}`}
                aria-current={slideIndex === index ? 'true' : undefined}
                onClick={() => goTo(slideIndex)}
              >
                {slideIndex === index && <i className="showcase-dot-fill" key={`${index}-${cycle}`} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="showcase-toggle"
            aria-label={paused ? 'Play slideshow' : 'Pause slideshow'}
            onClick={() => { setPaused((value) => !value); setCycle((value) => value + 1) }}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
          </button>
        </div>
      </div>
    </div>
  )
}
