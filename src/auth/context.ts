import { createContext } from 'react'
import type { AuthUser } from './types'

export interface AuthContextValue {
  user: AuthUser | null
  token: string | null
  loading: boolean
  error: string
  login: (usernameOrEmail: string, password: string) => Promise<AuthUser>
  register: (details: {
    fullName: string
    email: string
    username: string
    password: string
  }) => Promise<AuthUser>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
