import { useId } from 'react'
import './RetreatBackdrop.css'

type Photo = { src: string; small?: string }

/** Small repeatable random numbers, so the scene looks the same on every visit. */
function seeded(seed: number) {
  let value = seed
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

const fixed = (n: number) => Math.round(n * 10) / 10

/** A palm frond: leaflets on both sides of a curved stem, longest in the middle. */
function frond(
  [x0, y0]: [number, number],
  [cx, cy]: [number, number],
  [x1, y1]: [number, number],
  { leaves = 26, length = 150, droop = 0.45, seed = 3 } = {},
) {
  const random = seeded(seed)
  const parts: string[] = [`M${x0} ${y0} Q${cx} ${cy} ${x1} ${y1}`]
  for (let i = 1; i <= leaves; i += 1) {
    const t = 0.06 + (i / leaves) * 0.94
    const px = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t ** 2 * x1
    const py = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t ** 2 * y1
    let tx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx)
    let ty = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy)
    const tl = Math.hypot(tx, ty) || 1
    tx /= tl
    ty /= tl
    const base = length * (0.3 + 0.7 * Math.sin(Math.PI * Math.min(1, t * 1.12)) ** 0.7)
    for (const side of [1, -1]) {
      const size = base * (0.82 + random() * 0.32)
      const sweep = 0.3 + random() * 0.35
      const nx = -ty * side
      const ny = tx * side
      const tipX = px + nx * size + tx * size * sweep
      const tipY = py + ny * size * 0.85 + ty * size * sweep + size * (droop + random() * 0.25)
      const midX = (px + tipX) / 2
      const midY = (py + tipY) / 2
      const w = size * (0.07 + random() * 0.05)
      parts.push(
        `M${fixed(px)} ${fixed(py)} Q${fixed(midX + tx * w)} ${fixed(midY + ty * w)} ${fixed(tipX)} ${fixed(tipY)} Q${fixed(midX - tx * w)} ${fixed(midY - ty * w)} ${fixed(px)} ${fixed(py)}Z`,
      )
    }
  }
  return parts.join(' ')
}

/** A forest edge: many round tree crowns of different sizes, overlapping like real foliage. */
function canopy(seed: number, baseY: number, count: number, minR: number, maxR: number) {
  const random = seeded(seed)
  const crowns: string[] = [`M-50 ${baseY} H1650 V1000 H-50 Z`]
  for (let i = 0; i < count; i += 1) {
    const x = -60 + (1720 * i) / count + (random() - 0.5) * 60
    const r = minR + random() * (maxR - minR)
    // Taller toward the sides, lower in the middle, so the clearing opens in the centre.
    const edge = Math.abs(x - 800) / 800
    const y = baseY - r * 0.55 - edge * maxR * 1.1 - random() * maxR * 0.45
    crowns.push(`M${fixed(x - r)} ${fixed(y)} a${fixed(r)} ${fixed(r)} 0 1 1 ${fixed(r * 2)} 0 a${fixed(r)} ${fixed(r)} 0 1 1 ${fixed(-r * 2)} 0Z`)
    crowns.push(`M${fixed(x - r)} ${fixed(y)} H${fixed(x + r)} V${baseY + 4} H${fixed(x - r)} Z`)
  }
  return crowns.join(' ')
}

const FAR_TREES = canopy(7, 560, 44, 34, 70)
const MID_TREES = canopy(31, 650, 30, 46, 96)
const LEFT_FRONDS = [
  frond([-40, -30], [160, 40], [430, 170], { length: 150, seed: 10 }),
  frond([-60, 120], [140, 210], [360, 400], { length: 130, droop: 0.55, seed: 11 }),
  frond([-30, 330], [110, 380], [270, 560], { leaves: 20, length: 105, droop: 0.6, seed: 12 }),
].join(' ')
const RIGHT_FRONDS = [
  frond([1660, -20], [1440, 30], [1150, 150], { length: 155, seed: 13 }),
  frond([1670, 160], [1470, 230], [1260, 420], { length: 130, droop: 0.55, seed: 14 }),
].join(' ')
const GROUND_FERNS = [
  frond([-20, 1010], [90, 880], [300, 830], { leaves: 18, length: 70, droop: 0.2, seed: 15 }),
  frond([1620, 1010], [1520, 870], [1300, 840], { leaves: 18, length: 70, droop: 0.2, seed: 16 }),
].join(' ')

/** Shows the photo when one is given, otherwise a drawn pool hidden in the trees. */
export default function RetreatBackdrop({ photo }: { photo?: Photo }) {
  const id = useId().replaceAll(':', '')
  const ref = (name: string) => `url(#${id}-${name})`

  return (
    <div className="retreat-backdrop" aria-hidden="true">
      {photo ? (
        <img
          className="retreat-photo"
          src={photo.src}
          srcSet={photo.small ? `${photo.small} 1100w, ${photo.src} 2000w` : undefined}
          sizes="(max-width: 720px) 100vw, 64vw"
          alt=""
          decoding="async"
          fetchPriority="high"
        />
      ) : (
        <svg className="retreat-scene" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#c9d8b6" />
              <stop offset=".38" stopColor="#7e9e78" />
              <stop offset=".7" stopColor="#2f5242" />
              <stop offset="1" stopColor="#173226" />
            </linearGradient>
            <radialGradient id={`${id}-sun`} cx=".5" cy=".3" r=".5">
              <stop offset="0" stopColor="#fff3cf" stopOpacity=".95" />
              <stop offset=".35" stopColor="#f6e2a6" stopOpacity=".42" />
              <stop offset="1" stopColor="#f6e2a6" stopOpacity="0" />
            </radialGradient>
            <linearGradient id={`${id}-ray`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fffbe8" stopOpacity=".5" />
              <stop offset="1" stopColor="#fffbe8" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-pool`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#8fe3d6" />
              <stop offset=".45" stopColor="#3fb5ad" />
              <stop offset="1" stopColor="#177a78" />
            </linearGradient>
            <linearGradient id={`${id}-mist`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#eef3e4" stopOpacity="0" />
              <stop offset=".5" stopColor="#eef3e4" stopOpacity=".38" />
              <stop offset="1" stopColor="#eef3e4" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#1f3d30" />
              <stop offset="1" stopColor="#0c1d16" />
            </linearGradient>
            <filter id={`${id}-caustics`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency=".018 .05" numOctaves="2" seed="4" />
              <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 9 -4.6" />
            </filter>
            <filter id={`${id}-soft`}><feGaussianBlur stdDeviation="14" /></filter>
            <filter id={`${id}-haze`}><feGaussianBlur stdDeviation="3" /></filter>
            <clipPath id={`${id}-pool-shape`}>
              <path d="M520 742 L1080 742 L1250 1000 L350 1000 Z" />
            </clipPath>
          </defs>

          <rect width="1600" height="1000" fill={ref('sky')} />
          <circle className="retreat-sun" cx="800" cy="300" r="520" fill={ref('sun')} />
          <g className="retreat-rays" filter={ref('soft')}>
            <path d="M760 0 L840 0 L1010 780 L760 780 Z" fill={ref('ray')} />
            <path d="M650 0 L700 0 L660 760 L520 760 Z" fill={ref('ray')} opacity=".7" />
            <path d="M900 0 L940 0 L1220 720 L1120 720 Z" fill={ref('ray')} opacity=".55" />
          </g>

          <path d={FAR_TREES} fill="#4f7660" opacity=".8" filter={ref('haze')} />
          <rect y="430" width="1600" height="260" fill={ref('mist')} />
          <path d={MID_TREES} fill="#2c4e3d" />

          {/* The hidden pool, glowing in the clearing */}
          <path d="M300 712 Q800 680 1300 712 L1600 1000 L0 1000 Z" fill={ref('floor')} />
          <path d="M498 728 L1102 728 L1282 1000 L318 1000 Z" fill="#d9ccb0" />
          <path d="M520 742 L1080 742 L1250 1000 L350 1000 Z" fill={ref('pool')} />
          <g clipPath={ref('pool-shape')}>
            <rect className="retreat-caustics" x="300" y="700" width="1000" height="340" filter={ref('caustics')} opacity=".34" />
            <path d="M520 742 L1080 742 L1092 760 L508 760 Z" fill="#0f5b5a" opacity=".35" />
          </g>
          <ellipse cx="800" cy="745" rx="420" ry="18" fill="#fff8de" opacity=".35" filter={ref('haze')} />

          <g className="retreat-leaves retreat-leaves-left" fill="#0f241b">
            <path d={LEFT_FRONDS} stroke="#0f241b" strokeWidth="3" />
          </g>
          <g className="retreat-leaves retreat-leaves-right" fill="#112a1f">
            <path d={RIGHT_FRONDS} stroke="#112a1f" strokeWidth="3" />
          </g>
          <path d={GROUND_FERNS} fill="#0d2018" stroke="#0d2018" strokeWidth="3" />
        </svg>
      )}
      <span className="retreat-shade" />
    </div>
  )
}
