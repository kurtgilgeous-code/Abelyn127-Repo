import { type CSSProperties, useEffect, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { type Accommodation, accommodations } from '../data/accommodations'
import './HeroShowcase.css'

/** How long each space stays up, in milliseconds. */
const SLIDE_MS = 5500

/** How long one picture takes to fade into the next. */
const FADE_MS = 1600

type SceneShape = 'aframe' | 'balai' | 'bahay' | 'kubo' | 'gazebo' | 'pavilion'

/** Drawn picture for each space, shown until the resort's real photos are added. */
const SCENES: Record<string, SceneShape> = {
  'abelyns-cabin-glass': 'aframe',
  'bahay-hapag': 'bahay',
  'balai-delnor': 'balai',
  gazebo: 'gazebo',
  'balay-buknoy': 'bahay',
  'abelyns-mini-event-area': 'pavilion',
  'balai-andeng': 'balai',
  'calesa-tables': 'gazebo',
  'kubo-ni-gerrant': 'kubo',
}

function RoomScene({ stay, tone }: { stay: Accommodation, tone: number }) {
  const photo = stay.photos.find((item) => item.area === 'outside') ?? stay.photos[0]
  if (photo) return <img className="showcase-photo" src={photo.src} alt={photo.alt} decoding="async" />
  const scene = SCENES[stay.id] ?? 'bahay'
  return (
    <div className={`showcase-scene scene-${scene} tone-${tone}`} role="img" aria-label={`Drawing of ${stay.name} (photos coming soon)`}>
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

/**
 * Slideshow of every space: one picture and its name, fading slowly into the next while it
 * drifts closer. It stops while the tab is hidden, when the visitor presses pause, and for
 * visitors who prefer reduced motion (they can still use the lines to step through).
 */
export default function HeroShowcase() {
  const [index, setIndex] = useState(0)
  const [leaving, setLeaving] = useState<number | null>(null)
  const [cycle, setCycle] = useState(0)
  const [paused, setPaused] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [tabHidden, setTabHidden] = useState(() => document.hidden)

  useEffect(() => {
    const onVisibility = () => setTabHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const goTo = (next: number) => {
    if (next === index) return
    setLeaving(index)
    setIndex(next)
    setCycle((value) => value + 1)
  }

  const running = !paused && !tabHidden
  useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => {
      setLeaving(index)
      setIndex((index + 1) % accommodations.length)
    }, SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [index, cycle, running])

  return (
    <div className="hero-showcase">
      <div
        className={`showcase-stage ${running ? 'is-running' : 'is-paused'}`}
        role="region"
        aria-roledescription="carousel"
        aria-label="The spaces at Tampisawan"
        style={{ '--slide-ms': `${SLIDE_MS}ms`, '--fade-ms': `${FADE_MS}ms` } as CSSProperties}
      >
        <div className="showcase-slides" aria-live={running ? 'off' : 'polite'}>
          {accommodations.map((stay, slideIndex) => {
            const active = slideIndex === index
            const state = active ? 'is-active' : slideIndex === leaving ? 'is-leaving' : ''
            return (
              <div
                className={`showcase-slide ${state}`}
                key={stay.id}
                role="group"
                aria-roledescription="slide"
                aria-label={`${slideIndex + 1} of ${accommodations.length}: ${stay.name}`}
                aria-hidden={!active}
                inert={!active}
              >
                <div className="showcase-media">
                  <RoomScene stay={stay} tone={slideIndex % 3} />
                </div>
                <div className="showcase-shade" />
                <h2 className="showcase-name">{stay.name}</h2>
              </div>
            )
          })}
        </div>

        <div className="showcase-controls">
          <div className="showcase-dots" role="group" aria-label="Choose a space to show">
            {accommodations.map((stay, slideIndex) => (
              <button
                type="button"
                key={stay.id}
                className={`showcase-dot ${slideIndex === index ? 'is-active' : ''}`}
                aria-label={`Show ${stay.name}`}
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
