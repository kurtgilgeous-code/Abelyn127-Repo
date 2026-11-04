import { useEffect, type ReactNode } from 'react'
import { useAuth } from './auth/useAuth'
import type { AuthUser } from './auth/types'

export default function ProtectedRoute({
  role,
  children,
}: {
  role: AuthUser['role']
  children: ReactNode
}) {
  const { user, loading } = useAuth()

  useEffect(() => {
    if (loading) return
    if (!user) {
      window.location.replace('/login')
      return
    }
    if (user.role !== role) {
      window.location.replace(user.role === 'ADMIN' ? '/admin/dashboard' : '/customer/booking')
    }
  }, [loading, role, user])

  if (loading || !user || user.role !== role) {
    return <div className="auth-loading">Verifying your account…</div>
  }
  return children
}
