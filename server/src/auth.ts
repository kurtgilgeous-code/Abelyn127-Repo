import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import type { NextFunction, Request, Response } from 'express'
import type { UserRecord } from './db.js'

const TOKEN_LIFETIME = '8h'

export type UserRole = 'ADMIN' | 'CUSTOMER'

export interface AuthUser {
  id: string
  email: string
  username: string
  name: string
  role: UserRole
}

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser
    }
  }
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('JWT_SECRET must be configured with at least 32 characters in the project root .env file.')
  }
  return secret
}

export function authConfigurationError() {
  if (!process.env.DATABASE_URL) {
    return 'PostgreSQL is not configured. Set DATABASE_URL in the project root .env file.'
  }
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET, 'utf8') < 32) {
    return 'JWT_SECRET is missing or too short. Run the admin setup command to configure it.'
  }
  return null
}

export function publicUser(row: UserRecord): AuthUser {
  return {
    id: row.id,
    email: row.email ?? '',
    username: row.username,
    name: row.full_name,
    role: row.role,
  }
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash)
}

export function createAccessToken(user: AuthUser) {
  return jwt.sign({
    email: user.email,
    username: user.username,
    name: user.name,
    role: user.role,
  }, jwtSecret(), {
    subject: user.id,
    expiresIn: TOKEN_LIFETIME,
  })
}

export function requireUser(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  const authorization = request.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) {
    response.status(401).json({ message: 'Please sign in to continue.' })
    return
  }

  try {
    const payload = jwt.verify(token, jwtSecret())
    if (typeof payload === 'string' || typeof payload.sub !== 'string' ||
      (payload.role !== 'ADMIN' && payload.role !== 'CUSTOMER')) {
      response.status(401).json({ message: 'Your sign-in token is invalid. Please sign in again.' })
      return
    }
    request.authUser = {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      username: typeof payload.username === 'string' ? payload.username : '',
      name: typeof payload.name === 'string' ? payload.name : '',
      role: payload.role,
    }
    next()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('JWT_SECRET')) {
      response.status(503).json({ message: error.message })
      return
    }
    response.status(401).json({ message: 'Your sign-in token is invalid or expired. Please sign in again.' })
  }
}

export function requireAdmin(
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction,
) {
  if (request.authUser?.role !== 'ADMIN') {
    response.status(403).json({ message: 'Admin access requires an administrator account.' })
    return
  }
  next()
}
