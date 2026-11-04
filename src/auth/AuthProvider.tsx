import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { AuthContext } from './context'
import type { AuthUser } from './types'

const TOKEN_STORAGE_KEY = 'tampisawan_access_token'

function isAuthUser(value: unknown): value is AuthUser {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'email' in value &&
    typeof value.email === 'string' &&
    'username' in value &&
    typeof value.username === 'string' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'role' in value &&
    (value.role === 'ADMIN' || value.role === 'CUSTOMER')
  )
}

async function readError(response: Response) {
  try {
    const body: unknown = await response.json()
    if (typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string') {
      return body.message
    }
  } catch {
    return `Request failed (${response.status}).`
  }
  return `Request failed (${response.status}).`
}

function readAuthResponse(body: unknown): { user: AuthUser; token: string } {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('user' in body) ||
    !isAuthUser(body.user) ||
    !('token' in body) ||
    typeof body.token !== 'string' ||
    !body.token
  ) {
    throw new Error('The server returned an invalid sign-in response.')
  }
  return { user: body.user, token: body.token }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [token, setToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_STORAGE_KEY))
  const [loading, setLoading] = useState(() => Boolean(sessionStorage.getItem(TOKEN_STORAGE_KEY)))
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    const storedToken = token
    if (!storedToken) return

    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${storedToken}` } })
      .then(async (response) => {
        if (response.status === 401) {
          sessionStorage.removeItem(TOKEN_STORAGE_KEY)
          setToken(null)
          return null
        }
        if (!response.ok) throw new Error(await readError(response))

        const body: unknown = await response.json()
        if (typeof body !== 'object' || body === null || !('user' in body) || !isAuthUser(body.user)) {
          throw new Error('The server returned an invalid sign-in response.')
        }
        return body.user
      })
      .then((authenticatedUser) => {
        if (active && authenticatedUser) {
          setUser(authenticatedUser)
          setToken(storedToken)
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not verify your sign-in.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [token])

  const authenticate = useCallback(async (endpoint: string, payload: Record<string, string>) => {
    setError('')
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) throw new Error(await readError(response))

    const result = readAuthResponse(await response.json())
    sessionStorage.setItem(TOKEN_STORAGE_KEY, result.token)
    setUser(result.user)
    setToken(result.token)
    setError('')
    return result.user
  }, [])

  const login = useCallback(
    (usernameOrEmail: string, password: string) =>
      authenticate('/api/auth/login', { usernameOrEmail, password }),
    [authenticate],
  )

  const register = useCallback(
    (details: { fullName: string; email: string; username: string; password: string }) =>
      authenticate('/api/auth/register', details),
    [authenticate],
  )

  const logout = useCallback(async () => {
    if (token) {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error(await readError(response))
    }
    sessionStorage.removeItem(TOKEN_STORAGE_KEY)
    setUser(null)
    setToken(null)
    setError('')
  }, [token])

  const value = useMemo(
    () => ({ user, token, loading, error, login, register, logout }),
    [user, token, loading, error, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
