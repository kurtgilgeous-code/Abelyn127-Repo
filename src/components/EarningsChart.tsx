import { useLayoutEffect, useRef, useState } from 'react'
import { channelLabels, channelOrder, monthLabel, type MonthSummary } from '../utils/earnings'

const HEIGHT = 240
const MARGIN = { top: 28, right: 8, bottom: 28, left: 52 }
const GAP = 2 // surface gap between stacked segments
const MAX_BAR = 24

const pesoFull = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const pesoExact = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })

function niceStep(max: number) {
  const raw = max / 4
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw)
  return step ?? 10 * magnitude
}

function tickLabel(value: number, compact: boolean) {
  if (!compact) return pesoFull.format(value)
  if (value >= 1_000_000) return `₱${Number((value / 1_000_000).toFixed(1))}M`
  return `₱${Number((value / 1000).toFixed(1))}K`
}

/** Bar segment with a 4px rounded data-end (top) and a square base. */
function topRoundedPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, height, width / 2)
  return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`
}

export default function EarningsChart({
  months,
  selectedMonth,
  onSelectMonth,
}: {
  months: MonthSummary[]
  selectedMonth: string
  onSelectMonth: (monthKey: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  const [hovered, setHovered] = useState<string | null>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const update = () => setWidth(Math.max(280, Math.floor(element.getBoundingClientRect().width)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const plotWidth = width - MARGIN.left - MARGIN.right
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const maxNet = Math.max(0, ...months.map((month) => month.net))
  const step = maxNet > 0 ? niceStep(maxNet) : 1000
  const top = Math.max(step * 4, step * Math.ceil(maxNet / step))
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step)
  const compactTicks = top >= 10_000
  const band = plotWidth / months.length
  const barWidth = Math.min(MAX_BAR, band * 0.56)
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight
  const hoveredIndex = months.findIndex((month) => month.monthKey === hovered)
  const hoveredMonth = hoveredIndex >= 0 ? months[hoveredIndex] : null
  const labelEvery = band < 34 ? 2 : 1

  return (
    <div className="earnings-chart" ref={containerRef}>
      <svg width={width} height={HEIGHT} role="img" aria-label={`Net resort earnings by month, ${monthLabel(months[0].monthKey)} to ${monthLabel(months[months.length - 1].monthKey)}. Values are in the monthly summary table below.`}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className={tick === 0 ? 'chart-baseline' : 'chart-grid'} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
            <text className="chart-tick" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{tickLabel(tick, compactTicks)}</text>
          </g>
        ))}

        {months.map((month, index) => {
          const center = MARGIN.left + band * index + band / 2
          const x = center - barWidth / 2
          const visible = channelOrder.filter((channel) => month.byChannel[channel] > 0)
          const segments = visible.map((channel, segmentIndex) => {
            const start = visible.slice(0, segmentIndex).reduce((total, below) => total + month.byChannel[below], 0)
            const yTop = y(start + month.byChannel[channel])
            // Every segment above the bottom one gives up GAP px at its base: the surface gap.
            const yBottom = y(start) - (segmentIndex > 0 ? GAP : 0)
            const height = Math.max(0, yBottom - yTop)
            const isTop = segmentIndex === visible.length - 1
            return height <= 0 ? null : isTop
              ? <path key={channel} className={`chart-series-${channel}`} d={topRoundedPath(x, yTop, barWidth, height)} />
              : <rect key={channel} className={`chart-series-${channel}`} x={x} y={yTop} width={barWidth} height={height} />
          })
          const selected = month.monthKey === selectedMonth
          return (
            <g key={month.monthKey} className={`chart-column ${hovered === month.monthKey ? 'is-hovered' : ''}`}>
              {segments}
              {selected && month.net > 0 && (
                <text className="chart-value" x={center} y={y(month.net) - 8} textAnchor="middle">{tickLabel(month.net, month.net >= 10_000)}</text>
              )}
              {(selected || (index % labelEvery === 0 && (labelEvery === 1 ||
                (months[index - 1]?.monthKey !== selectedMonth && months[index + 1]?.monthKey !== selectedMonth)))) && (
                <text className={`chart-month ${selected ? 'is-selected' : ''}`} x={center} y={HEIGHT - 8} textAnchor="middle">{monthLabel(month.monthKey, 'short')}</text>
              )}
              <rect
                className="chart-hit"
                x={MARGIN.left + band * index}
                y={MARGIN.top - 20}
                width={band}
                height={plotHeight + 20 + MARGIN.bottom}
                tabIndex={0}
                role="button"
                aria-label={`${monthLabel(month.monthKey)}: net ${pesoExact.format(month.net)}. Select this month.`}
                aria-pressed={selected}
                onPointerEnter={() => setHovered(month.monthKey)}
                onPointerLeave={() => setHovered((current) => current === month.monthKey ? null : current)}
                onFocus={() => setHovered(month.monthKey)}
                onBlur={() => setHovered((current) => current === month.monthKey ? null : current)}
                onClick={() => onSelectMonth(month.monthKey)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectMonth(month.monthKey)
                  }
                }}
              />
            </g>
          )
        })}
      </svg>

      {hoveredMonth && (
        <div
          className="chart-tooltip"
          // Beside the hovered column (right of it, or left in the right half), never over the bar.
          style={hoveredIndex < months.length / 2
            ? { left: MARGIN.left + band * (hoveredIndex + 1) + 4, top: MARGIN.top - 8 }
            : { left: MARGIN.left + band * hoveredIndex - 4, top: MARGIN.top - 8, transform: 'translateX(-100%)' }}
          role="status"
        >
          <b>{pesoExact.format(hoveredMonth.net)}</b>
          <span className="tooltip-title">{monthLabel(hoveredMonth.monthKey)} · net earnings</span>
          {channelOrder.map((channel) => (
            <span className="tooltip-row" key={channel}>
              <i className={`tooltip-key chart-key-${channel}`} aria-hidden="true" />
              <strong>{pesoExact.format(hoveredMonth.byChannel[channel])}</strong>
              <small>{channelLabels[channel]}</small>
            </span>
          ))}
          {hoveredMonth.refundReview > 0 && <small className="tooltip-note">{pesoExact.format(hoveredMonth.refundReview)} held for refund review</small>}
        </div>
      )}
    </div>
  )
}
