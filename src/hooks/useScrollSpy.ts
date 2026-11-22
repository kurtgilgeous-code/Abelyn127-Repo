import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Tracks which page section the visitor is reading, for highlighting the matching nav link.
 * `ids` must be in page order. A section counts as current once its top passes a line 30% down
 * the viewport (below the sticky header).
 *
 * `scrollTo(id)` glides to a section and holds the highlight on it while the page scrolls, so
 * the highlight doesn't flicker across the sections in between.
 */
export function useScrollSpy(ids: string[], landings?: Record<string, string>) {
  const [active, setActive] = useState<string | null>(null)
  const lock = useRef<{ id: string, until: number } | null>(null)
  const key = ids.join(',')
  const landingsRef = useRef(landings)

  useEffect(() => {
    const sectionIds = key.split(',')
    const pending = { frame: 0 }

    const compute = () => {
      pending.frame = 0
      if (lock.current) {
        if (Date.now() < lock.current.until) return
        lock.current = null
      }
      const header = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0
      const line = header + window.innerHeight * 0.3
      let current: string | null = null
      for (const id of sectionIds) {
        const top = document.getElementById(id)?.getBoundingClientRect().top
        if (top !== undefined && top <= line) current = id
      }
      // At the very bottom, a short last section may never reach the line: pick it if visible.
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      const last = document.getElementById(sectionIds[sectionIds.length - 1])
      if (atBottom && last && last.getBoundingClientRect().top < window.innerHeight) current = sectionIds[sectionIds.length - 1]
      setActive(current)
    }
    const schedule = () => { if (!pending.frame) pending.frame = window.requestAnimationFrame(compute) }
    // A programmatic glide is finished: release the hold and re-check where we landed.
    const onScrollEnd = () => { lock.current = null; schedule() }

    schedule()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scrollend', onScrollEnd)
    return () => {
      window.cancelAnimationFrame(pending.frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scrollend', onScrollEnd)
    }
  }, [key])

  /** Glides to a section's content (see `landings`), just below the sticky header. */
  const scrollTo = useCallback((id: string, behavior?: ScrollBehavior) => {
    const section = document.getElementById(id)
    if (!section) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const selector = landingsRef.current?.[id]
    const target = (selector ? section.querySelector<HTMLElement>(selector) : null) ?? section
    // Hold the highlight on the destination; the 1.2 s cap covers browsers without `scrollend`.
    lock.current = { id, until: Date.now() + 1200 }
    setActive(id)
    // Layout position, so an element still animating in doesn't shift the landing spot.
    let top = 0
    for (let node: HTMLElement | null = target; node; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
    const header = document.querySelector('.site-header')?.getBoundingClientRect().height ?? 0
    window.scrollTo({
      top: id === ids[0] ? 0 : Math.max(0, top - header - 12),
      behavior: behavior ?? (reduceMotion ? 'auto' : 'smooth'),
    })
    window.history.replaceState(null, '', `#${id}`)
    // ids[0] is the page top; `key` tracks the list itself.
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  return { active, scrollTo }
}
