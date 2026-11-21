import { useEffect, useRef } from 'react'

/** Surfaces that get the pointer-tracking glass spotlight (see theme/luxury.css). */
const GLASS_SELECTOR = [
  '.glass-card',
  '.hero-showcase',
  '.stay-card',
  '.booking-card',
  '.followup-card',
  '.amenity-panel',
  '.rate-detail-card',
  '.review-modal',
  '.login-card',
  '.earnings-card',
  '.admin-booking-card',
  '.users-panel',
  '.users-stats > div',
].join(',')

/**
 * One delegated listener for the whole app: while a mouse moves over a glass surface,
 * store the pointer position on it as --mouse-x / --mouse-y. Touch screens and visitors
 * who prefer reduced motion keep the static specular highlight instead.
 */
export function useGlassSpotlight() {
  useEffect(() => {
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const pending = { frame: 0, event: null as PointerEvent | null }
    const apply = () => {
      pending.frame = 0
      const event = pending.event
      if (!event || !(event.target instanceof Element)) return
      const surface = event.target.closest<HTMLElement>(GLASS_SELECTOR)
      if (!surface) return
      const box = surface.getBoundingClientRect()
      surface.style.setProperty('--mouse-x', `${event.clientX - box.left}px`)
      surface.style.setProperty('--mouse-y', `${event.clientY - box.top}px`)
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || motion.matches) return
      pending.event = event
      if (!pending.frame) pending.frame = window.requestAnimationFrame(apply)
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.cancelAnimationFrame(pending.frame)
      document.removeEventListener('pointermove', onMove)
    }
  }, [])
}

/** Ref for a hairline progress bar, scaled 0 → 1 (scaleX) as the page scrolls. */
export function useScrollProgress<T extends HTMLElement>() {
  const bar = useRef<T>(null)
  useEffect(() => {
    const pending = { frame: 0 }
    const update = () => {
      pending.frame = 0
      const el = bar.current
      if (!el) return
      const max = document.documentElement.scrollHeight - window.innerHeight
      const progress = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      el.style.transform = `scaleX(${progress})`
    }
    const schedule = () => { if (!pending.frame) pending.frame = window.requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.cancelAnimationFrame(pending.frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return bar
}
