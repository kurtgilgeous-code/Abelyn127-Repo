import AOS from 'aos'
import 'aos/dist/aos.css'
import { useEffect } from 'react'

/**
 * Starts AOS (Animate On Scroll) for elements marked with `data-aos`.
 * Each element animates once, the first time it scrolls into view. Visitors who
 * turned on "reduce motion" see everything immediately with no animation.
 */
export function useAnimateOnScroll() {
  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    AOS.init({
      once: true,
      duration: 700,
      easing: 'ease-out-cubic',
      offset: 40,
      anchorPlacement: 'top-bottom',
      disable: reduceMotion,
    })
    // Fonts and lazy images shift the layout after start-up: recalculate trigger points.
    const refresh = () => AOS.refresh()
    window.addEventListener('load', refresh)
    void document.fonts?.ready.then(refresh)
    return () => window.removeEventListener('load', refresh)
  }, [])
}
