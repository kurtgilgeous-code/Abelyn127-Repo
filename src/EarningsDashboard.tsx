import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, ChevronLeft, ChevronRight, Download, Printer, TrendingDown, TrendingUp } from 'lucide-react'
import type { Booking } from './data/bookings'
import EarningsChart from './components/EarningsChart'
import ResortLogo from './components/ResortLogo'
import Tooltip from './components/Tooltip'
import {
  buildLedger,
  ledgerToCsv,
  cashToCollect,
  channelLabels,
  channelOrder,
  currentMonthKey,
  monthLabel,
  monthRange,
  selectableMonths,
  shiftMonth,
  summarizeMonth,
  type LedgerEntry,
  type MonthSummary,
} from './utils/earnings'
import './EarningsDashboard.css'

const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const pesoExact = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', minimumFractionDigits: 2 })

function receivedLabel(iso: string) {
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function Delta({ current, previous, previousMonth }: { current: number, previous: number, previousMonth: string }) {
  const against = `vs ${monthLabel(previousMonth)}`
  if (previous === 0 && current === 0) return <span className="earnings-delta is-flat">No change {against}</span>
  if (previous === 0) return <span className="earnings-delta is-up"><TrendingUp size={14} /> New earnings {against} (₱0)</span>
  const change = (current - previous) / previous
  const up = change >= 0
  return (
    <span className={`earnings-delta ${up ? 'is-up' : 'is-down'}`}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {up ? '+' : '−'}{Math.abs(change * 100).toFixed(1)}% {against}
    </span>
  )
}

function LedgerTable({ entries, compact = false }: { entries: LedgerEntry[], compact?: boolean }) {
  return (
    <table className={`earnings-table ledger-table ${compact ? 'is-print' : ''}`}>
      <thead>
        <tr>
          <th scope="col">Received</th>
          <th scope="col">Reference</th>
          <th scope="col">Guest</th>
          <th scope="col">Stay</th>
          <th scope="col">Method</th>
          <th scope="col" className="num">Collected</th>
          <th scope="col" className="num">Gateway fee</th>
          <th scope="col" className="num">Net to resort</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id} className={entry.refundReview ? 'is-refund-review' : ''}>
            <td>{receivedLabel(entry.receivedAt)}</td>
            <td className="mono">{entry.reference}</td>
            <td>{entry.guest}</td>
            <td>{entry.accommodation}</td>
            <td>{entry.methodLabel}</td>
            <td className="num">{pesoExact.format(entry.gross)}</td>
            <td className="num">{entry.gatewayFee ? pesoExact.format(entry.gatewayFee) : '—'}</td>
            <td className="num">
              {entry.refundReview
                ? <span className="refund-flag">Needs adjustment</span>
                : pesoExact.format(entry.net)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function PrintReport({
  summary,
  entries,
  toCollect,
  preparedBy,
  generatedAt,
}: {
  summary: MonthSummary
  entries: LedgerEntry[]
  toCollect: number
  preparedBy: string
  generatedAt: Date
}) {
  return (
    <div className="earnings-print-report" aria-hidden="true">
      <header className="print-header">
        <ResortLogo className="print-logo" tone="print" />
        <div>
          <span className="print-kicker">TAMPISAWAN 927 · ABELYN&apos;S PRIVATE POOL</span>
          <h1>Monthly Earnings Report</h1>
          <p className="print-period">{monthLabel(summary.monthKey)}</p>
        </div>
      </header>
      <dl className="print-meta">
        <div><dt>Prepared by</dt><dd>{preparedBy}</dd></div>
        <div><dt>Generated</dt><dd>{generatedAt.toLocaleString('en-PH', { timeZone: 'Asia/Manila' })} (PH time)</dd></div>
        <div><dt>Basis</dt><dd>Payments received, by date verified</dd></div>
      </dl>

      <section className="print-summary">
        <h2>Summary</h2>
        <table className="earnings-table is-print">
          <tbody>
            {channelOrder.map((channel) => (
              <tr key={channel}><th scope="row">{channelLabels[channel]}</th><td className="num">{pesoExact.format(summary.byChannel[channel])}</td></tr>
            ))}
            <tr className="print-total"><th scope="row">Net resort earnings</th><td className="num">{pesoExact.format(summary.net)}</td></tr>
            <tr><th scope="row">Total collected (incl. gateway fees)</th><td className="num">{pesoExact.format(summary.gross)}</td></tr>
            <tr><th scope="row">Online gateway fees (older bookings)</th><td className="num">{pesoExact.format(summary.gatewayFees)}</td></tr>
            <tr><th scope="row">Held for booking adjustment (excluded) · {summary.refundReviewCount} payment{summary.refundReviewCount === 1 ? '' : 's'}</th><td className="num">{pesoExact.format(summary.refundReview)}</td></tr>
            <tr><th scope="row">Payments received · bookings</th><td className="num">{summary.payments} · {summary.bookings}</td></tr>
            <tr><th scope="row">Cash balance still to collect (check-ins this month, not yet earned)</th><td className="num">{pesoExact.format(toCollect)}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Payment ledger</h2>
        {entries.length ? <LedgerTable entries={entries} compact /> : <p className="print-empty">No payments were received this month.</p>}
      </section>

      <p className="print-note">
        Earnings count payments marked received, in the month they were verified (Philippine time). The 2.5% online gateway fee
        on GCash reservations is collected on behalf of the payment gateway and is excluded. Payments on bookings marked date
        unavailable or cancelled are held for booking adjustment and excluded until settled.
      </p>
      <div className="print-signatures">
        <span>Prepared by</span>
        <span>Checked by</span>
      </div>
    </div>
  )
}

export default function EarningsDashboard({ bookings, preparedBy }: { bookings: Booking[], preparedBy: string }) {
  const nowMonth = currentMonthKey()
  const [month, setMonth] = useState(nowMonth)
  const [generatedAt, setGeneratedAt] = useState(() => new Date())

  const ledger = useMemo(() => buildLedger(bookings), [bookings])
  const options = useMemo(() => selectableMonths(ledger, nowMonth), [ledger, nowMonth])
  const summary = useMemo(() => summarizeMonth(ledger, month), [ledger, month])
  const previous = useMemo(() => summarizeMonth(ledger, shiftMonth(month, -1)), [ledger, month])
  const trend = useMemo(() => monthRange(month, 12).map((key) => summarizeMonth(ledger, key)), [ledger, month])
  const entries = useMemo(() => ledger.filter((entry) => entry.monthKey === month), [ledger, month])
  const toCollect = useMemo(() => cashToCollect(bookings, month), [bookings, month])
  const earliest = options[options.length - 1]

  const printReport = () => {
    setGeneratedAt(new Date())
    const cleanup = () => {
      document.body.classList.remove('printing-earnings-report')
      window.removeEventListener('afterprint', cleanup)
    }
    window.addEventListener('afterprint', cleanup)
    document.body.classList.add('printing-earnings-report')
    // Let React commit the new "generated" time before the print dialog snapshots the page.
    window.requestAnimationFrame(() => window.print())
  }

  /** Downloads the selected month's payment ledger as a CSV file (opens in Excel / Google Sheets). */
  const exportCsv = () => {
    // The BOM lets Excel read the peso sign and accented names as UTF-8.
    const blob = new Blob(['\uFEFF' + ledgerToCsv(entries)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'tampisawan-earnings-' + month + '.csv'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="earnings-root">
      <div className="earnings-heading">
        <div>
          <span className="admin-eyebrow">FINANCE · RECORDS</span>
          <h1>Earnings</h1>
          <p>Resort earnings from received payments, following the payment hierarchy. Online gateway fees are shown separately and never counted as resort income.</p>
        </div>
      </div>

      <div className="earnings-filters" role="group" aria-label="Report month">
        <button type="button" className="earnings-icon-button" aria-label="Previous month" disabled={month <= earliest} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
        <label className="earnings-sr-only" htmlFor="earnings-month">Month</label>
        <select id="earnings-month" value={month} onChange={(event) => setMonth(event.target.value)}>
          {options.map((key) => <option key={key} value={key}>{monthLabel(key)}{key === nowMonth ? ' (this month)' : ''}</option>)}
        </select>
        <button type="button" className="earnings-icon-button" aria-label="Next month" disabled={month >= nowMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
        <Tooltip label={entries.length === 0 ? 'No payments recorded this month' : ''} wrap><button type="button" className="earnings-print-button earnings-csv-button" onClick={exportCsv} disabled={entries.length === 0}><Download size={15} /> Export CSV</button></Tooltip>
        <button type="button" className="earnings-print-button" onClick={printReport}><Printer size={15} /> Print monthly report</button>
      </div>

      <section className="earnings-overview">
        <div className="earnings-card earnings-hero">
          <span className="earnings-label">Net resort earnings · {monthLabel(month)}</span>
          <strong className="earnings-hero-value">{peso.format(summary.net)}</strong>
          <Delta current={summary.net} previous={previous.net} previousMonth={shiftMonth(month, -1)} />
          <ul className="earnings-mix" aria-label="Earnings by channel">
            {channelOrder.map((channel) => (
              <li key={channel}>
                <i className={`chart-key-${channel}`} aria-hidden="true" />
                <span>{channelLabels[channel]}</span>
                <b>{pesoExact.format(summary.byChannel[channel])}</b>
                <small>{summary.net > 0 ? `${Math.round((summary.byChannel[channel] / summary.net) * 100)}%` : '—'}</small>
              </li>
            ))}
          </ul>
        </div>

        <div className="earnings-tiles">
          <div className="earnings-card earnings-tile">
            <span className="earnings-label">Total collected</span>
            <strong>{peso.format(summary.gross)}</strong>
            <small>Including gateway fees</small>
          </div>
          <div className="earnings-card earnings-tile">
            <span className="earnings-label">Gateway fees (pass-through)</span>
            <strong>{peso.format(summary.gatewayFees)}</strong>
            <small>Older bookings · not income</small>
          </div>
          <div className="earnings-card earnings-tile">
            <span className="earnings-label">Payments received</span>
            <strong>{summary.payments.toLocaleString('en-PH')}</strong>
            <small>Across {summary.bookings} booking{summary.bookings === 1 ? '' : 's'}</small>
          </div>
          <div className="earnings-card earnings-tile">
            <span className="earnings-label">Cash still to collect</span>
            <strong>{peso.format(toCollect)}</strong>
            <small>Balances on confirmed check-ins this month</small>
          </div>
          {summary.refundReview > 0 && (
            <div className="earnings-card earnings-tile is-warning" role="status">
              <span className="earnings-label"><AlertTriangle size={13} /> Held for booking adjustment</span>
              <strong>{peso.format(summary.refundReview)}</strong>
              <small>{summary.refundReviewCount} payment{summary.refundReviewCount === 1 ? '' : 's'} on unavailable or cancelled bookings · excluded</small>
            </div>
          )}
        </div>
      </section>

      <section className="earnings-card earnings-chart-card">
        <div className="earnings-card-head">
          <div>
            <h2>Net resort earnings · last 12 months</h2>
            <p>Select a month to see its records.</p>
          </div>
          <ul className="earnings-legend" aria-label="Legend">
            {channelOrder.map((channel) => (
              <li key={channel}><i className={`chart-key-${channel}`} aria-hidden="true" />{channelLabels[channel]}</li>
            ))}
          </ul>
        </div>
        <EarningsChart months={trend} selectedMonth={month} onSelectMonth={setMonth} />
      </section>

      <section className="earnings-card">
        <div className="earnings-card-head">
          <div>
            <h2>Monthly summary</h2>
            <p>The same 12 months as the chart, newest first.</p>
          </div>
        </div>
        <div className="earnings-table-scroll">
          <table className="earnings-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className="num">Payments</th>
                {channelOrder.map((channel) => <th scope="col" className="num" key={channel}>{channelLabels[channel]}</th>)}
                <th scope="col" className="num">Gateway fees</th>
                <th scope="col" className="num">Needs adjustment</th>
                <th scope="col" className="num">Net earnings</th>
              </tr>
            </thead>
            <tbody>
              {[...trend].reverse().map((row) => (
                <tr key={row.monthKey} className={row.monthKey === month ? 'is-selected' : ''}>
                  <th scope="row">
                    <button type="button" className="earnings-link" onClick={() => setMonth(row.monthKey)} aria-pressed={row.monthKey === month}>{monthLabel(row.monthKey)}</button>
                  </th>
                  <td className="num">{row.payments}</td>
                  {channelOrder.map((channel) => <td className="num" key={channel}>{pesoExact.format(row.byChannel[channel])}</td>)}
                  <td className="num">{pesoExact.format(row.gatewayFees)}</td>
                  <td className="num">{row.refundReview ? pesoExact.format(row.refundReview) : '—'}</td>
                  <td className="num strong">{pesoExact.format(row.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="earnings-card">
        <div className="earnings-card-head">
          <div>
            <h2>Payment ledger · {monthLabel(month)}</h2>
            <p>Every payment received this month. Rows marked needs adjustment are excluded from earnings.</p>
          </div>
        </div>
        {entries.length ? (
          <div className="earnings-table-scroll"><LedgerTable entries={entries} /></div>
        ) : (
          <p className="earnings-empty">No payments were received in {monthLabel(month)}.</p>
        )}
      </section>

      {createPortal(
        <PrintReport summary={summary} entries={entries} toCollect={toCollect} preparedBy={preparedBy} generatedAt={generatedAt} />,
        document.body,
      )}
    </div>
  )
}
