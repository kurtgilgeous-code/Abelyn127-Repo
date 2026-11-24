import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, History, Hourglass, Search, ShieldCheck, Trash2, UserX, X, XCircle } from 'lucide-react'
import { type AdminUser, type BookingOutcome, type UserBookingSummary, removeAdminUser } from './api/admin'
import { formatPeso } from './utils/pricing'
import Tooltip from './components/Tooltip'
import './AdminUsersTab.css'

const outcomeLabels: Record<BookingOutcome, string> = {
  SUCCESSFUL: 'Successful',
  FAILED: 'Failed / expired',
  PENDING_HOLD: 'Walk-in voucher',
  IN_PROGRESS: 'In progress',
}

const statusLabels: Record<string, string> = {
  PENDING: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled by admin',
  DATE_UNAVAILABLE: 'Paid · dates taken (needs adjustment)',
  PENDING_HOLD: 'Walk-in voucher',
  EXPIRED: 'Hold expired',
  CANCELLED_BY_GCASH_PRIORITY: 'Released · confirmed for another guest',
}

const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
const timestampLabel = (value: string | null) =>
  value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

function HistoryDrawer({ user, onClose }: { user: AdminUser, onClose: () => void }) {
  const [filter, setFilter] = useState<BookingOutcome | 'ALL'>('ALL')
  const closeRef = useRef<HTMLButtonElement>(null)
  useEscape(onClose)
  useEffect(() => { closeRef.current?.focus() }, [])
  const rows = user.bookingsHistory.filter((booking) => filter === 'ALL' || booking.outcome === filter)
  const count = (outcome: BookingOutcome) => user.bookingsHistory.filter((booking) => booking.outcome === outcome).length
  return (
    <div className="admin-modal-backdrop users-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="users-drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <button ref={closeRef} type="button" className="admin-modal-close" aria-label="Close booking history" onClick={onClose}><X size={18} /></button>
        <span className="admin-eyebrow"><History size={14} /> BOOKING TRANSPARENCY</span>
        <h2 id="history-title">{user.fullName}</h2>
        <p className="users-drawer-sub">@{user.username}{user.email ? ` · ${user.email}` : ''} · joined {timestampLabel(user.createdAt)}</p>
        <div className="users-filter" role="group" aria-label="Filter bookings">
          {(['ALL', 'SUCCESSFUL', 'FAILED', 'PENDING_HOLD', 'IN_PROGRESS'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>
              {value === 'ALL' ? 'All' : outcomeLabels[value]} <span>{value === 'ALL' ? user.bookingsHistory.length : count(value)}</span>
            </button>
          ))}
        </div>
        {rows.length === 0 ? (
          <p className="users-empty">{user.bookingsHistory.length === 0 ? 'No bookings on this account yet.' : 'No bookings in this group.'}</p>
        ) : (
          <ol className="users-history">
            {rows.map((booking: UserBookingSummary) => (
              <li key={booking.id} className={`outcome-${booking.outcome.toLowerCase()}`}>
                <div className="users-history-top">
                  <b>{booking.referenceNumber}</b>
                  <span className={`outcome-pill outcome-${booking.outcome.toLowerCase()}`}>{outcomeLabels[booking.outcome]}</span>
                </div>
                <span className="users-history-stay">{booking.accommodationName} · {dateLabel(booking.checkInDate)} → {dateLabel(booking.checkOutDate)}</span>
                <span className="users-history-meta">
                  {statusLabels[booking.status] ?? booking.status} · {formatPeso(booking.amount)}{booking.paidAmount > 0 ? ` · ${formatPeso(booking.paidAmount)} received` : ''}
                </span>
                <small>
                  Created {timestampLabel(booking.createdAt)}
                  {booking.holdReferenceNumber ? ` · from hold ${booking.holdReferenceNumber}` : ''}
                </small>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}

function RemoveDialog({ user, token, onClose, onRemoved }: {
  user: AdminUser
  token: string
  onClose: () => void
  onRemoved: (message: string) => void
}) {
  const [mode, setMode] = useState<'keep' | 'purge'>('keep')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEscape(onClose)
  const total = user.bookingsHistory.length
  const paid = user.bookingsHistory.filter((booking) => booking.paidAmount > 0).length
  const isAdmin = user.role === 'ADMIN'
  const purgeReady = mode === 'keep' || confirmText.trim() === user.username

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await removeAdminUser(token, user.id, mode === 'purge')
      onRemoved(result.message)
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove this user.')
      setBusy(false)
    }
  }

  return (
    <div className="admin-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="admin-walkin-modal users-remove-modal" role="dialog" aria-modal="true" aria-labelledby="remove-title">
        <button type="button" className="admin-modal-close" aria-label="Close" onClick={onClose} disabled={busy}><X size={18} /></button>
        <span className="admin-eyebrow"><UserX size={14} /> REMOVE USER</span>
        <h2 id="remove-title">Remove {user.fullName}?</h2>
        <p>@{user.username} has {total} booking{total === 1 ? '' : 's'}{paid ? `, ${paid} with payments received` : ''}. They will be signed out and can no longer log in.</p>
        <div className="users-remove-options" role="radiogroup" aria-label="Removal option">
          <button type="button" role="radio" aria-checked={mode === 'keep'} className={mode === 'keep' ? 'is-selected' : ''} onClick={() => setMode('keep')}>
            <ShieldCheck size={18} />
            <span>
              <b>Remove User Account (Keep Financial Records)</b>
              <small>Bookings, receipts and payments stay in the dashboard and earnings, under the guest&apos;s name. Recommended for real customers.</small>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'purge'} className={`is-danger ${mode === 'purge' ? 'is-selected' : ''}`} disabled={isAdmin} onClick={() => setMode('purge')}>
            <Trash2 size={18} />
            <span>
              <b>Remove User &amp; Purge All Test Bookings</b>
              <small>{isAdmin
                ? 'Not available for admin accounts: walk-in cash bookings are recorded under the admin who logged them.'
                : `Also permanently deletes ${total} booking${total === 1 ? '' : 's'} and their payment records and screenshots. For test accounts only.`}</small>
            </span>
          </button>
        </div>
        {mode === 'purge' && (
          <div className="users-purge-confirm">
            {paid > 0 && (
              <p role="alert"><AlertTriangle size={14} /> {paid} of these bookings have money received. Purging removes them from earnings reports.</p>
            )}
            <label htmlFor="purge-confirm">Type <b>{user.username}</b> to confirm</label>
            <input id="purge-confirm" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} autoComplete="off" />
          </div>
        )}
        {error && <p className="admin-error" role="alert">{error}</p>}
        <div className="users-remove-actions">
          <button type="button" className="users-secondary-button" onClick={onClose} disabled={busy}>Keep user</button>
          <button type="button" className={`users-danger-button ${mode === 'keep' ? 'is-calm' : ''}`} onClick={submit} disabled={busy || !purgeReady}>
            {busy ? 'Removing…' : mode === 'purge' ? 'Remove & purge bookings' : 'Remove account, keep records'}
          </button>
        </div>
      </section>
    </div>
  )
}

export default function AdminUsersTab({ users, loading, error, token, currentUserId, onChanged }: {
  users: AdminUser[]
  loading: boolean
  error: string
  token: string
  currentUserId: string | undefined
  onChanged: () => Promise<void>
}) {
  const [search, setSearch] = useState('')
  const [historyUserId, setHistoryUserId] = useState('')
  const [removeUserId, setRemoveUserId] = useState('')
  const [notice, setNotice] = useState('')

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    return users.filter((user) => !query ||
      [user.fullName, user.username, user.email].some((value) => value.toLowerCase().includes(query)))
  }, [search, users])
  const totals = useMemo(() => ({
    customers: users.filter((user) => user.role === 'CUSTOMER').length,
    successful: users.reduce((sum, user) => sum + user.successfulBookings, 0),
    failed: users.reduce((sum, user) => sum + user.failedOrExpiredBookings, 0),
  }), [users])
  const historyUser = users.find((user) => user.id === historyUserId)
  const removeUser = users.find((user) => user.id === removeUserId)

  return (
    <section className="users-tab" aria-labelledby="users-heading">
      <div className="admin-page-heading">
        <div>
          <span className="admin-eyebrow">USERS &amp; GUESTS</span>
          <h1 id="users-heading">Guest accounts.</h1>
          <p>See who booked successfully, whose holds or payments failed, and remove accounts safely.</p>
        </div>
      </div>

      <div className="users-stats">
        <div><span>Accounts</span><b>{users.length}</b><small>{totals.customers} customers</small></div>
        <div className="is-success"><span><CheckCircle2 size={14} /> Successful bookings</span><b>{totals.successful}</b><small>Confirmed or fully paid</small></div>
        <div className="is-failed"><span><XCircle size={14} /> Failed / expired</span><b>{totals.failed}</b><small>Expired, cancelled, released, or unpaid</small></div>
      </div>

      <div className="users-panel">
        <div className="users-toolbar">
          <label className="users-search">
            <Search size={15} aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, username or email" aria-label="Search users" />
          </label>
          <span>{visible.length} of {users.length}</span>
        </div>
        {notice && (
          <p className="users-notice" role="status">
            <CheckCircle2 size={15} /> {notice}
            <button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} /></button>
          </p>
        )}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {loading && users.length === 0 ? (
          <p className="users-empty">Loading accounts…</p>
        ) : visible.length === 0 ? (
          <p className="users-empty">{users.length ? 'No accounts match your search.' : 'No accounts yet.'}</p>
        ) : (
          <table className="users-table">
            <thead>
              <tr>
                <th scope="col">Guest</th>
                <th scope="col">Role</th>
                <th scope="col">Successful</th>
                <th scope="col">Failed / expired</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => {
                const isSelf = user.id === currentUserId
                return (
                  <tr key={user.id}>
                    <td data-label="Guest">
                      <span className="users-avatar" aria-hidden="true">{(user.fullName || user.username).slice(0, 1).toUpperCase()}</span>
                      <span className="users-identity">
                        <b>{user.fullName}{isSelf && <em> (you)</em>}</b>
                        <small>{user.email || 'No email'} · @{user.username}</small>
                      </span>
                    </td>
                    <td data-label="Role"><span className={`users-role role-${user.role.toLowerCase()}`}>{user.role === 'ADMIN' ? 'Admin' : 'Customer'}</span></td>
                    <td data-label="Successful"><span className="count-badge is-success">{user.successfulBookings}</span></td>
                    <td data-label="Failed / expired">
                      <span className={`count-badge ${user.failedOrExpiredBookings ? 'is-failed' : 'is-zero'}`}>{user.failedOrExpiredBookings}</span>
                      {user.pendingHolds > 0 && <Tooltip label="Active walk-in vouchers"><span className="count-badge is-hold" tabIndex={0}><Hourglass size={10} /> {user.pendingHolds}</span></Tooltip>}
                    </td>
                    <td className="users-actions">
                      <button type="button" className="users-secondary-button" onClick={() => setHistoryUserId(user.id)}><History size={13} /> View History</button>
                      <Tooltip label={isSelf ? 'You cannot remove your own account' : ''} wrap><button type="button" className="users-danger-button" disabled={isSelf} onClick={() => setRemoveUserId(user.id)}><UserX size={13} /> Remove User</button></Tooltip>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {historyUser && <HistoryDrawer user={historyUser} onClose={() => setHistoryUserId('')} />}
      {removeUser && (
        <RemoveDialog
          user={removeUser}
          token={token}
          onClose={() => setRemoveUserId('')}
          onRemoved={(message) => {
            setRemoveUserId('')
            setNotice(message)
            void onChanged()
          }}
        />
      )}
    </section>
  )
}
