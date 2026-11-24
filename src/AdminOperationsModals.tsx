import { type FormEvent, useEffect, useState } from 'react'
import { CalendarClock, CalendarOff, Trash2, X } from 'lucide-react'
import { type BlockedDate, createBlockedDate, deleteBlockedDate, fetchBlockedDates, rescheduleBooking } from './api/admin'
import { accommodations } from './data/accommodations'
import { type Booking, displayCheckoutDate, tourDetails } from './data/bookings'

const todayInManila = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}
const daysBetween = (start: string, end: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000)
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })

function useEscape(onClose: () => void, disabled = false) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !disabled) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, disabled])
}

/** Close dates (whole resort or chosen accommodations) for maintenance, weather, or private use. */
export function BlockDatesModal({ token, onClose, onChanged }: { token: string, onClose: () => void, onChanged: () => void }) {
  const [blocks, setBlocks] = useState<BlockedDate[]>([])
  const [loading, setLoading] = useState(true)
  const [wholeResort, setWholeResort] = useState(true)
  const [selected, setSelected] = useState<string[]>([])
  const [startDate, setStartDate] = useState(todayInManila)
  // The form asks for the last closed day (inclusive); the API takes the first open day.
  const [lastDate, setLastDate] = useState(todayInManila)
  const [reason, setReason] = useState('Pool maintenance')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEscape(onClose, busy)

  useEffect(() => {
    let active = true
    fetchBlockedDates(token)
      .then((result) => { if (active) setBlocks(result) })
      .catch((loadError: unknown) => { if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load blocked dates.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  const reload = async () => setBlocks(await fetchBlockedDates(token))

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!wholeResort && selected.length === 0) {
      setError('Choose at least one accommodation, or close the whole resort.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await createBlockedDate(token, {
        accommodationIds: wholeResort ? [] : selected,
        startDate,
        endDate: addDays(lastDate, 1),
        reason: reason.trim(),
      })
      setNotice(result.conflictingReferences.length
        ? `Dates closed. ${result.conflictingReferences.length} confirmed booking${result.conflictingReferences.length === 1 ? ' is' : 's are'} already on these dates and still stand${result.conflictingReferences.length === 1 ? 's' : ''}: ${result.conflictingReferences.join(', ')}. Reschedule or contact ${result.conflictingReferences.length === 1 ? 'that guest' : 'those guests'}.`
        : 'Dates closed. Customers can no longer book or hold them.')
      await reload()
      onChanged()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not block these dates.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (block: BlockedDate) => {
    if (!window.confirm(`Reopen ${block.accommodationName} for ${dateLabel(block.startDate)} – ${dateLabel(addDays(block.endDate, -1))}?`)) return
    setError('')
    try {
      await deleteBlockedDate(token, block.id)
      await reload()
      setNotice('Dates reopened for booking.')
      onChanged()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not reopen these dates.')
    }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="admin-walkin-modal ops-modal" role="dialog" aria-modal="true" aria-labelledby="block-title">
        <button type="button" className="admin-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        <span className="admin-eyebrow"><CalendarOff size={14} /> RESORT OPERATIONS</span>
        <h2 id="block-title">Block Dates / Maintenance</h2>
        <p>Close dates for pool cleaning, weather, or private owner use. Customers can&apos;t book, hold, or pay for closed dates. Confirmed bookings already on those dates are kept, so you can reschedule them.</p>
        <form onSubmit={submit}>
          <div className="admin-walkin-date-row">
            <span><label htmlFor="block-start">First closed day</label><input id="block-start" type="date" min={todayInManila()} value={startDate} onChange={(event) => { setStartDate(event.target.value); if (lastDate < event.target.value) setLastDate(event.target.value) }} required /></span>
            <span><label htmlFor="block-end">Last closed day</label><input id="block-end" type="date" min={startDate} value={lastDate} onChange={(event) => setLastDate(event.target.value)} required /></span>
          </div>
          <fieldset className="ops-scope">
            <legend>What&apos;s closed</legend>
            <label><input type="radio" name="block-scope" checked={wholeResort} onChange={() => setWholeResort(true)} /> Whole resort &amp; pool</label>
            <label><input type="radio" name="block-scope" checked={!wholeResort} onChange={() => setWholeResort(false)} /> Only some accommodations</label>
          </fieldset>
          {!wholeResort && (
            <fieldset className="admin-walkin-stays">
              <legend>Accommodations to close</legend>
              {accommodations.map((stay) => {
                const checked = selected.includes(stay.id)
                return (
                  <label key={stay.id} className={checked ? 'is-checked' : ''}>
                    <input type="checkbox" checked={checked} onChange={() => setSelected(checked ? selected.filter((id) => id !== stay.id) : [...selected, stay.id])} />
                    <span>{stay.name}</span>
                  </label>
                )
              })}
            </fieldset>
          )}
          <label htmlFor="block-reason">Reason (shown to admins only)</label>
          <input id="block-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={200} placeholder="e.g. Pool cleaning, typhoon, owner's private use" />
          {error && <p className="admin-error" role="alert">{error}</p>}
          {notice && <p className="ops-notice" role="status">{notice}</p>}
          <button type="submit" className="walkin-submit-button" disabled={busy}>
            <CalendarOff size={15} /> {busy ? 'Closing dates…' : `Close ${daysBetween(startDate, lastDate) + 1} day${daysBetween(startDate, lastDate) === 0 ? '' : 's'}`}
          </button>
        </form>
        <h3 className="ops-subheading">Upcoming closed dates</h3>
        {loading ? <p className="ops-empty">Loading…</p> : blocks.length === 0 ? (
          <p className="ops-empty">No dates are closed.</p>
        ) : (
          <ul className="ops-block-list">
            {blocks.map((block) => (
              <li key={block.id}>
                <span>
                  <b>{dateLabel(block.startDate)}{daysBetween(block.startDate, block.endDate) > 1 ? ` – ${dateLabel(addDays(block.endDate, -1))}` : ''}</b>
                  <small>{block.accommodationName}{block.reason ? ` · ${block.reason}` : ''}</small>
                </span>
                <button type="button" aria-label={`Reopen ${block.accommodationName} on ${block.startDate}`} onClick={() => remove(block)}><Trash2 size={14} /> Reopen</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/** Move a confirmed booking to new dates; its length of stay, reference, price, and payments stay the same. */
export function RescheduleModal({ booking, token, onClose, onDone }: {
  booking: Booking
  token: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const nights = daysBetween(booking.checkInDate, booking.checkOutDate)
  const [checkInDate, setCheckInDate] = useState(booking.checkInDate < todayInManila() ? todayInManila() : booking.checkInDate)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscape(onClose, busy)
  const newCheckOut = addDays(checkInDate, nights)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await rescheduleBooking(token, booking.id, checkInDate)
      onDone(`${booking.referenceNumber} moved to ${dateLabel(checkInDate)}. Reference number and payments are unchanged.`)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not reschedule this booking.')
      setBusy(false)
    }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="admin-walkin-modal ops-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
        <button type="button" className="admin-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        <span className="admin-eyebrow"><CalendarClock size={14} /> RESCHEDULE BOOKING</span>
        <h2 id="reschedule-title">{booking.customerName}</h2>
        <p>{booking.referenceNumber} · {booking.accommodationName} · {tourDetails[booking.tourType].label}. The length of stay ({nights} {nights === 1 ? 'day' : 'days'}), price, reference number, and payment history stay the same.</p>
        <div className="ops-reschedule-summary">
          <span>Current<b>{dateLabel(booking.checkInDate)} → {dateLabel(displayCheckoutDate(booking.checkOutDate, booking.tourType))}</b></span>
          <span>New<b>{dateLabel(checkInDate)} → {dateLabel(displayCheckoutDate(newCheckOut, booking.tourType))}</b></span>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="reschedule-date">New check-in date</label>
          <input id="reschedule-date" type="date" min={todayInManila()} value={checkInDate} onChange={(event) => setCheckInDate(event.target.value)} required />
          <small className="ops-hint">Refused if the new dates overlap another confirmed booking or closed dates. Unpaid walk-in vouchers on the new dates are released (first come, first served).</small>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button type="submit" className="walkin-submit-button" disabled={busy || checkInDate === booking.checkInDate}>
            <CalendarClock size={15} /> {busy ? 'Rescheduling…' : 'Move booking'}
          </button>
        </form>
      </section>
    </div>
  )
}
