import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Compass, House, Plus, TentTree, Users } from 'lucide-react'
import type { Accommodation } from '../data/accommodations'
import { formatPeso } from '../utils/pricing'
import './StayCarousel.css'

interface StayCarouselProps {
  stays: Accommodation[]
  selectedIds: string[]
  onToggle: (id: string) => void
  /** Shown after the price, e.g. "/22 hrs" or "/day tour". */
  priceSuffix: string
}

function placeholderIcon(index: number) {
  if (index === 3 || index === 7) return <TentTree size={30} />
  if (index === 2 || index === 5) return <Compass size={30} />
  return <House size={30} />
}

/**
 * Accommodation picker for the booking form: name pills on top, the current
 * place large in the middle with its neighbours peeking out, and arrows below.
 * Several places can be selected; the pills show which ones are in the booking.
 */
export default function StayCarousel({ stays, selectedIds, onToggle, priceSuffix }: StayCarouselProps) {
  const [active, setActive] = useState(0)
  /** How far the cards are dragged, in cards (negative = toward the next one). */
  const [dragShift, setDragShift] = useState(0)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number, x: number, y: number, moved: boolean } | null>(null)
  const suppressClick = useRef(false)
  const wheel = useRef({ total: 0, lockedUntil: 0 })
  const last = stays.length - 1
  const go = (index: number) => setActive(Math.max(0, Math.min(last, index)))

  /** Pixels the pointer must travel to move one card (the gap between card centres). */
  const stepPx = () => (stageRef.current?.clientWidth ?? 400) * 0.62 * 0.58

  const endDrag = () => {
    const state = drag.current
    drag.current = null
    if (!state?.moved) return
    let steps = Math.round(-dragShift)
    if (steps === 0 && Math.abs(dragShift) > 0.15) steps = dragShift < 0 ? 1 : -1
    go(active + steps)
    setDragShift(0)
    setDragging(false)
    suppressClick.current = true
  }

  return (
    <div className="stay-carousel">
      <div className="stay-carousel-pills" role="tablist" aria-label="Accommodations">
        {stays.map((stay, index) => {
          const selected = selectedIds.includes(stay.id)
          return (
            <button
              key={stay.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={`stay-pill ${index === active ? 'is-active' : ''} ${selected ? 'is-selected' : ''}`}
              onClick={() => go(index)}
            >
              {selected && <Check size={12} strokeWidth={3} aria-hidden="true" />}
              {stay.name}
            </button>
          )
        })}
      </div>

      <div
        ref={stageRef}
        className={`stay-carousel-stage ${dragging ? 'is-dragging' : ''}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
        }}
        onPointerMove={(event) => {
          const state = drag.current
          if (!state || state.id !== event.pointerId) return
          const dx = event.clientX - state.x
          const dy = event.clientY - state.y
          if (!state.moved) {
            if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) return
            state.moved = true
            setDragging(true)
            event.currentTarget.setPointerCapture(event.pointerId)
          }
          // Resist a little past the first and last card.
          const atEdge = (active === 0 && dx > 0) || (active === last && dx < 0)
          setDragShift((atEdge ? dx * 0.3 : dx) / stepPx())
        }}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          if (!suppressClick.current) return
          suppressClick.current = false
          event.preventDefault()
          event.stopPropagation()
        }}
        onWheel={(event) => {
          if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
          const now = Date.now()
          if (now < wheel.current.lockedUntil) return
          wheel.current.total += event.deltaX
          if (Math.abs(wheel.current.total) > 50) {
            go(active + (wheel.current.total > 0 ? 1 : -1))
            wheel.current = { total: 0, lockedUntil: now + 450 }
          }
        }}
      >
        {stays.map((stay, index) => {
          const offset = index - active
          const position = offset + (dragging ? dragShift : 0)
          const distance = Math.abs(position)
          const selected = selectedIds.includes(stay.id)
          const isCenter = offset === 0
          return (
            <article
              key={stay.id}
              className={`stay-slide ${isCenter ? 'is-center' : ''} ${selected ? 'is-selected' : ''}`}
              style={{
                transform: `translateX(calc(-50% + ${position * 58}%)) scale(${1 - Math.min(distance, 2) * 0.13})`,
                zIndex: 10 - Math.round(distance),
                opacity: distance > 2 ? 0 : 1,
                pointerEvents: distance > 2 ? 'none' : undefined,
              }}
              aria-hidden={!isCenter}
              onClick={isCenter ? undefined : () => go(index)}
            >
              <div className={`stay-slide-media listing-media-${(index % 4) + 1}`}>
                {stay.photos[0]
                  ? <img src={stay.photos[0].src} alt="" loading="lazy" decoding="async" draggable={false} />
                  : <span className="stay-slide-icon" aria-hidden="true">{placeholderIcon(index)}</span>}
                {stay.exclusiveWholeResort && <span className="stay-slide-badge">Exclusive</span>}
                {selected && <span className="stay-slide-check" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>}
              </div>
              <div className="stay-slide-body">
                <h4>{stay.name}</h4>
                <p className="stay-slide-meta">
                  <span><Users size={13} aria-hidden="true" /> Up to {stay.capacity} pax</span>
                  <span className="stay-slide-price">{formatPeso(stay.baseRate)}<small>{priceSuffix}</small></span>
                </p>
                {isCenter && (
                  <button
                    type="button"
                    className={`stay-slide-toggle ${selected ? 'is-selected' : ''}`}
                    aria-pressed={selected}
                    aria-label={selected ? `Remove ${stay.name} from booking` : `Select ${stay.name}`}
                    onClick={() => onToggle(stay.id)}
                  >
                    {selected ? <><Check size={14} /> Selected · Remove</> : <><Plus size={14} /> Select</>}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      <div className="stay-carousel-nav">
        <button type="button" aria-label="Previous accommodation" disabled={active === 0} onClick={() => go(active - 1)}><ArrowLeft size={16} /></button>
        <span>{active + 1} / {stays.length}</span>
        <button type="button" aria-label="Next accommodation" disabled={active === last} onClick={() => go(active + 1)}><ArrowRight size={16} /></button>
      </div>
    </div>
  )
}
