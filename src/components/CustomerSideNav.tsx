import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, LayoutDashboard, LogIn, LogOut, Moon, Sun, X } from 'lucide-react'
import ResortLogo from './ResortLogo'
import { sideNavSections } from './sideNavSections'
import './CustomerSideNav.css'

type CustomerSideNavProps = {
  open: boolean
  onClose: () => void
  activeSection: string | null
  onNavigate: (id: string) => void
  bookingCount: number
  user: { email: string, role: string } | null
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onSignOut: () => void
}

export default function CustomerSideNav({
  open,
  onClose,
  activeSection,
  onNavigate,
  bookingCount,
  user,
  theme,
  onToggleTheme,
  onSignOut,
}: CustomerSideNavProps) {
  const panelRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // While open: Escape closes, the page behind stays still, and focus returns afterwards.
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    closeRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      opener?.focus({ preventScroll: true })
    }
  }, [open, onClose])

  // Keep keyboard focus inside the panel while it is open.
  const keepFocusInside = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const items = panelRef.current?.querySelectorAll<HTMLElement>('a[href], button')
    if (!items?.length) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Close first so the page can scroll again, then glide to the section.
  const goTo = (id: string) => {
    onClose()
    window.requestAnimationFrame(() => onNavigate(id))
  }

  return createPortal(
    <>
      {open && <button type="button" className="customer-side-backdrop" aria-label="Close menu" tabIndex={-1} onClick={onClose} />}
      <aside
        id="customer-side-menu"
        ref={panelRef}
        className={`customer-side${open ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Site menu"
        onKeyDown={keepFocusInside}
      >
        <button ref={closeRef} type="button" className="customer-side-close" aria-label="Close menu" onClick={onClose}><X size={20} /></button>
        <a
          className="customer-side-brand"
          href="#home"
          aria-label="Tampisawan home"
          onClick={(event) => { event.preventDefault(); goTo('home') }}
        >
          <ResortLogo />
        </a>

        <nav className="customer-side-links" aria-label="Page sections">
          {sideNavSections.map(({ id, label, icon: Icon }) => (
            <a
              key={id}
              href={`#${id}`}
              className={activeSection === id ? 'is-active' : ''}
              aria-current={activeSection === id ? 'location' : undefined}
              onClick={(event) => { event.preventDefault(); goTo(id) }}
            >
              <Icon size={20} />
              <span>{label}</span>
              {id === 'my-inquiry' && bookingCount > 0 && <small>{bookingCount}</small>}
            </a>
          ))}
          {user?.role === 'ADMIN' && (
            <a href="/admin/dashboard"><LayoutDashboard size={20} /><span>Admin dashboard</span></a>
          )}
        </nav>

        <div className="customer-side-bottom">
          {user ? (
            <a
              className="customer-side-cta"
              href="#booking"
              onClick={(event) => { event.preventDefault(); goTo('booking') }}
            >
              Book a tour <ArrowUpRight size={18} />
            </a>
          ) : (
            <a className="customer-side-cta" href="/login?next=preview"><LogIn size={18} /> Sign In to Book</a>
          )}
          <button type="button" className="customer-side-row" onClick={onToggleTheme}>
            {theme === 'light' ? <Moon size={19} /> : <Sun size={19} />}
            <span>Switch to {theme === 'light' ? 'night' : 'day'} mode</span>
          </button>
          {user && (
            <div className="customer-side-account">
              <span title={user.email}>{user.email}</span>
              <button type="button" aria-label="Sign out" onClick={() => { onClose(); onSignOut() }}><LogOut size={18} /> Sign out</button>
            </div>
          )}
        </div>
      </aside>
    </>,
    document.body,
  )
}
