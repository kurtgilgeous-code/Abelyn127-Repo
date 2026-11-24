import { useId } from 'react'
import './AmbientAtmosphere.css'

/** Deterministic pseudo-random numbers, so the canopy never reshuffles. */
function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 9301 + 49297) % 233280
    return value / 233280
  }
}

// Leafy boughs of the canopy: [centerX, centerY, radiusX, radiusY, leafCount]
const CLUSTERS: [number, number, number, number, number][] = [
  [150, 210, 118, 84, 46],
  [252, 178, 74, 62, 26],
  [62, 238, 72, 64, 24],
  [228, 292, 78, 46, 22],
  [44, 140, 66, 54, 18],
  [160, 108, 96, 62, 30],
  [282, 270, 46, 42, 12],
]

const random = seeded(2741)

/** Elongated, lance-shaped mango leaves, drooping slightly as they do on the tree. */
const LEAVES = CLUSTERS.flatMap(([cx, cy, rx, ry, count]) =>
  Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2
    const distance = Math.sqrt(random())
    return {
      x: Math.round(cx + Math.cos(angle) * rx * distance),
      y: Math.round(cy + Math.sin(angle) * ry * distance),
      rotate: Math.round(20 + random() * 140),
      scale: (0.75 + random() * 0.55).toFixed(2),
      tone: Math.floor(random() * 3),
    }
  }),
)

// Hanging mangoes: [x, y, tilt]
const MANGOES: [number, number, number][] = [
  [118, 322, -8], [196, 340, 6], [76, 300, -4], [252, 322, 10], [166, 288, -6], [226, 250, 4],
]

const LEAF = 'M0 0Q15 -6 34 0Q15 6 0 0Z'

function MangoTree({ side }: { side: 'left' | 'right' }) {
  const id = useId().replaceAll(':', '')
  return (
    <svg className={`mango-tree mango-tree-${side}`} viewBox="0 0 320 900" preserveAspectRatio="xMinYMin meet" focusable="false">
      <defs>
        <linearGradient id={`${id}-mango`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="mango-stop-1" />
          <stop offset="55%" className="mango-stop-2" />
          <stop offset="100%" className="mango-stop-3" />
        </linearGradient>
      </defs>

      {/* Sturdy, gnarled trunk */}
      <path
        className="mango-trunk"
        d="M14 900C28 790 6 708 36 610C56 540 46 476 86 404C106 368 128 340 146 298L166 306C150 350 132 392 120 432C102 500 106 562 88 642C72 722 88 806 78 900Z"
      />
      <g className="mango-branches">
        <path d="M108 418C140 380 176 340 222 302" />
        <path d="M118 388C100 340 82 300 60 252" />
        <path d="M152 300C186 262 220 228 252 190" />
        <path d="M94 520C130 500 164 486 204 470" />
        <path d="M146 300C150 250 154 196 160 120" />
      </g>

      {/* The canopy sways gently from the top of the trunk */}
      <g className="mango-canopy">
        {CLUSTERS.map(([cx, cy, rx, ry], index) => (
          <ellipse key={index} className="mango-shade" cx={cx} cy={cy} rx={rx * 0.86} ry={ry * 0.8} />
        ))}
        {LEAVES.map((leaf, index) => (
          <path
            key={index}
            className={`mango-leaf mango-leaf-${leaf.tone}`}
            d={LEAF}
            transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.rotate}) scale(${leaf.scale})`}
          />
        ))}
        {MANGOES.map(([x, y, tilt], index) => (
          <g key={index} className="mango-fruit" style={{ animationDelay: `${-index * 0.9}s` }}>
            <path className="mango-stem" d={`M${x} ${y - 20}L${x} ${y - 9}`} />
            <ellipse cx={x} cy={y} rx="9" ry="13" transform={`rotate(${tilt} ${x} ${y})`} fill={`url(#${id}-mango)`} />
          </g>
        ))}
      </g>
    </svg>
  )
}

/**
 * Ambient background: Philippine mango trees along the screen edges with diagonal sunrays
 * (Day) or moonlit sapphire beams (Night) filtering through. Decorative and click-through.
 */
export default function AmbientAtmosphere() {
  return (
    <div className="ambient-atmosphere" aria-hidden="true">
      <div className="ambient-rays">
        <span /><span /><span /><span /><span />
      </div>
      <MangoTree side="left" />
      <MangoTree side="right" />
    </div>
  )
}
