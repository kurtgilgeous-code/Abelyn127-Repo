import { useId } from 'react'

interface GeraintAvatarProps {
  size?: number
  className?: string
  /** Accessible name. Leave empty when the avatar sits next to visible text. */
  title?: string
}

const FUR = '#D9A066'
const FUR_DARK = '#C68B59'
const CREAM = '#FEF3C7'
const CREAM_SHADE = '#FDE68A'
const NOSE = '#451A03'
const EMERALD = '#059669'
const GOLD = '#F59E0B'

const earPath = 'M31 31 C19 28 9 42 12 59 C14 70 24 73 28.5 64 C32 56 31.5 44 35 35 Z'
const innerEarPath = 'M27.5 37.5 C20.5 39.5 17 49.5 18.8 59 C20.3 64.5 24.6 64 25.8 58.8 C27.6 51.5 27.8 44.5 30.4 39.6 Z'

export default function GeraintAvatar({ size = 40, className = '', title = '' }: GeraintAvatarProps) {
  const id = useId().replaceAll(':', '')
  const labelled = Boolean(title)

  return (
    <svg
      className={`geraint-avatar ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role={labelled ? 'img' : undefined}
      aria-hidden={labelled ? undefined : true}
      aria-labelledby={labelled ? `${id}-title` : undefined}
      focusable="false"
    >
      {labelled && <title id={`${id}-title`}>{title}</title>}
      <defs>
        <radialGradient id={`${id}-bg`} cx="50%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#ECFDF5" />
          <stop offset="100%" stopColor="#A7F3D0" />
        </radialGradient>
        <radialGradient id={`${id}-fur`} cx="45%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#E4B06F" />
          <stop offset="100%" stopColor={FUR} />
        </radialGradient>
        <clipPath id={`${id}-clip`}>
          <circle cx="50" cy="50" r="50" />
        </clipPath>
      </defs>

      <g clipPath={`url(#${id}-clip)`}>
        <circle cx="50" cy="50" r="50" fill={`url(#${id}-bg)`} />

        {/* Neck and chest */}
        <path d="M31 70 Q50 98 69 70 L78 104 L22 104 Z" fill={FUR_DARK} />
        <path d="M41 80 Q50 92 59 80 L62 104 L38 104 Z" fill={CREAM} opacity=".85" />

        {/* Head */}
        <ellipse cx="50" cy="50" rx="26.5" ry="24.5" fill={`url(#${id}-fur)`} />
        <path d="M44 27.5 Q47 22 50 26.5 Q53 21.5 56 27.5 Q50 30 44 27.5 Z" fill={FUR} />
        <path d="M50 30 C46.5 37.5 45.5 45 47 52 L53 52 C54.5 45 53.5 37.5 50 30 Z" fill={CREAM_SHADE} opacity=".55" />

        {/* Floppy ears */}
        <path d={earPath} fill={FUR_DARK} />
        <path d={innerEarPath} fill={CREAM} opacity=".7" />
        <g transform="translate(100 0) scale(-1 1)">
          <path d={earPath} fill={FUR_DARK} />
          <path d={innerEarPath} fill={CREAM} opacity=".7" />
        </g>

        {/* Cheeks */}
        <ellipse cx="34.5" cy="58" rx="3.6" ry="2.1" fill="#F9A8A8" opacity=".45" />
        <ellipse cx="65.5" cy="58" rx="3.6" ry="2.1" fill="#F9A8A8" opacity=".45" />

        {/* Muzzle */}
        <ellipse cx="50" cy="60.5" rx="14.5" ry="10.8" fill={CREAM} />
        <ellipse cx="50" cy="64.5" rx="11" ry="6" fill={CREAM_SHADE} opacity=".55" />

        {/* Brows and eyes */}
        <path d="M35.5 40.5 Q39.5 37.6 43.5 39.8" stroke="#A86B3C" strokeWidth="1.7" strokeLinecap="round" fill="none" />
        <path d="M64.5 40.5 Q60.5 37.6 56.5 39.8" stroke="#A86B3C" strokeWidth="1.7" strokeLinecap="round" fill="none" />
        <circle cx="40" cy="47.5" r="4.4" fill="#1C1917" />
        <circle cx="60" cy="47.5" r="4.4" fill="#1C1917" />
        <circle cx="41.6" cy="45.9" r="1.55" fill="#fff" />
        <circle cx="61.6" cy="45.9" r="1.55" fill="#fff" />
        <circle cx="38.9" cy="49.1" r=".7" fill="#fff" opacity=".85" />
        <circle cx="58.9" cy="49.1" r=".7" fill="#fff" opacity=".85" />

        {/* Nose */}
        <path d="M44.6 55.6 Q50 52.6 55.4 55.6 Q55.4 59.3 50 61.3 Q44.6 59.3 44.6 55.6 Z" fill={NOSE} />
        <ellipse cx="48.2" cy="55.7" rx="1.7" ry=".9" fill="#fff" opacity=".55" />

        {/* Smile and tongue */}
        <path d="M47.5 65.6 Q50 71.5 52.5 65.6 Q50 66.8 47.5 65.6 Z" fill="#FB7185" />
        <path d="M50 61.3 V63.6 M43.4 63 Q47 67.4 50 63.6 Q53 67.4 56.6 63" stroke={NOSE} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        {/* Tropical collar and tag */}
        <path d="M30.5 74.5 Q50 86 69.5 74.5 L70.5 81.5 Q50 93 29.5 81.5 Z" fill={EMERALD} />
        <path d="M33 78.6 Q50 88.4 67 78.6" stroke="#34D399" strokeWidth="1" fill="none" opacity=".7" />
        <circle cx="50" cy="90" r="6.2" fill={GOLD} stroke="#B45309" strokeWidth="1.2" />
        <circle cx="50" cy="91.4" r="1.7" fill="#B45309" />
        <circle cx="47.6" cy="88.4" r=".9" fill="#B45309" />
        <circle cx="50" cy="87.6" r=".9" fill="#B45309" />
        <circle cx="52.4" cy="88.4" r=".9" fill="#B45309" />
      </g>
    </svg>
  )
}
