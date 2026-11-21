import { useId } from 'react'

/**
 * Tampisawan · 927 Abelyn's Private Pool brand mark, redrawn from the official logo as a
 * transparent, scalable SVG: a royal-cobalt chevron gable roof with a champagne-gold double
 * border, coral-terracotta script "Tampisawan", and a gold-coral subtitle.
 *
 * tone:
 * - "auto"   follows the Day / Night theme (colors come from --logo-* CSS variables)
 * - "onDark" always tuned for dark backgrounds (e.g. the hero photo)
 * - "print"  tuned for white paper (receipts, printed reports)
 */
export default function ResortLogo({ className = '', tone = 'auto' }: {
  className?: string
  tone?: 'auto' | 'onDark' | 'print'
}) {
  const id = useId().replaceAll(':', '')
  // Chevron gable roof: outer apex → right foot → inner apex → left foot.
  const roof = 'M 499 26 L 978 545 L 782 545 L 499 236 L 216 545 L 21 545 Z'

  return (
    <svg
      className={`resort-logo resort-logo-tone-${tone} ${className}`.trim()}
      viewBox="0 0 1680 880"
      role="img"
      aria-labelledby={`${id}-title`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title id={`${id}-title`}>Tampisawan · 927 Abelyn&apos;s Private Pool</title>
      <defs>
        <linearGradient id={`${id}-cobalt`} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" className="logo-stop-cobalt-1" />
          <stop offset="100%" className="logo-stop-cobalt-2" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" className="logo-stop-gold-1" />
          <stop offset="45%" className="logo-stop-gold-2" />
          <stop offset="100%" className="logo-stop-gold-1" />
        </linearGradient>
        <linearGradient id={`${id}-coral`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="logo-stop-coral-1" />
          <stop offset="100%" className="logo-stop-coral-2" />
        </linearGradient>
      </defs>

      <g className="logo-roof">
        {/* Outer gold band, then a fine champagne line inside it: the double-line border. */}
        <path d={roof} fill={`url(#${id}-cobalt)`} stroke={`url(#${id}-gold)`} strokeWidth="26" strokeLinejoin="round" />
        <path d={roof} fill="none" className="logo-gold-inner" strokeWidth="6" strokeLinejoin="round" />
        <path d={roof} fill="none" className="logo-roof-edge" strokeWidth="2" strokeLinejoin="round" />
      </g>

      <text
        className="logo-script"
        x="216"
        y="752"
        fill={`url(#${id}-coral)`}
        textLength="1440"
        lengthAdjust="spacingAndGlyphs"
      >
        Tampisawan
      </text>
      <text
        className="logo-subtitle"
        x="862"
        y="852"
        textLength="792"
        lengthAdjust="spacingAndGlyphs"
      >
        927 Abelyn&#8217;s Private Pool
      </text>
    </svg>
  )
}
