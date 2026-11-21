// HitPay redirects to /booking/return/<booking reference> and appends its own
// ?reference=<payment request id>, so the path segment takes precedence over the query.
export function bookingReferenceFromLocation() {
  const match = window.location.pathname.match(/^\/booking\/return\/([^/]+)\/?$/)
  if (match) {
    try {
      return decodeURIComponent(match[1]).trim()
    } catch {
      return ''
    }
  }
  return new URLSearchParams(window.location.search).get('reference')?.trim() ?? ''
}
