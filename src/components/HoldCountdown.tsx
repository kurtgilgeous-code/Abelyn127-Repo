import { useEffect, useState } from 'react'
import { holdMillisecondsLeft } from '../data/bookings'

/** Live HH:MM:SS countdown to a pending hold's 24-hour expiry. */
export default function HoldCountdown({ expiresAt, className = '' }: { expiresAt: string, className?: string }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const left = holdMillisecondsLeft(expiresAt, now)
  const totalSeconds = Math.floor(left / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')

  return (
    <span className={`hold-countdown ${left === 0 ? 'is-expired' : ''} ${className}`.trim()} role="timer" aria-live="off">
      {left === 0 ? 'Expired' : `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`}
    </span>
  )
}
