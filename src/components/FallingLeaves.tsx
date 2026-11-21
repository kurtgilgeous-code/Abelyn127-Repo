import type { CSSProperties } from 'react'
import './FallingLeaves.css'

/** Small deterministic pseudo-random generator, so the leaves don't reshuffle on re-render. */
function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 9301 + 49297) % 233280
    return value / 233280
  }
}

const LEAF_COUNT = 16
/** Extra smaller, fainter, slower leaves that read as further away. */
const FAR_LEAF_COUNT = 10
const random = seeded(927)

const leaves = Array.from({ length: LEAF_COUNT + FAR_LEAF_COUNT }, (_, index) => {
  const far = index >= LEAF_COUNT
  return {
    key: index,
    far,
    shape: index % 3,
    tone: index % 4,
    style: {
      '--leaf-left': `${Math.round(random() * 96)}%`,
      '--leaf-size': far ? `${Math.round(9 + random() * 6)}px` : `${Math.round(14 + random() * 16)}px`,
      '--leaf-fall': far ? `${Math.round(26 + random() * 14)}s` : `${Math.round(16 + random() * 14)}s`,
      // Negative delays start each leaf part-way down, so the screen isn't empty on load.
      '--leaf-delay': `${-Math.round(random() * 30)}s`,
      '--leaf-sway': `${Math.round(3 + random() * 3)}s`,
      '--leaf-drift': `${Math.round(-60 + random() * 120)}px`,
      '--leaf-spin': `${Math.round(180 + random() * 360)}deg`,
    } as CSSProperties,
  }
})

const shapes = [
  // Broad leaf with a midrib
  <><path d="M12 1C5 6 3 13 6 20c2 3 4 3 6 3s4 0 6-3c3-7 1-14-6-19Z" /><path className="leaf-vein" d="M12 3v19" /></>,
  // Slim tropical leaf
  <><path d="M12 1c-4 5-5 11-3 17 1 3 2 5 3 5s2-2 3-5c2-6 1-12-3-17Z" /><path className="leaf-vein" d="M12 3v19" /></>,
  // Rounded leaf
  <><path d="M12 2C6 4 3 10 5 16c1 4 4 7 7 7s6-3 7-7c2-6-1-12-7-14Z" /><path className="leaf-vein" d="M12 4v18M12 11l-4-3M12 15l4-3" /></>,
]

/** Decorative falling leaves behind the landing page. Hidden for reduced motion and in print. */
export default function FallingLeaves() {
  return (
    <div className="falling-leaves" aria-hidden="true">
      {leaves.map((leaf) => (
        <span className={`falling-leaf leaf-tone-${leaf.tone}${leaf.far ? ' is-far' : ''}`} key={leaf.key} style={leaf.style}>
          <svg viewBox="0 0 24 24" focusable="false">{shapes[leaf.shape]}</svg>
        </span>
      ))}
    </div>
  )
}
