import type { Request, Response } from 'express'
import { createCustomer, findUserById, findUserByLogin } from './db.js'
import {
  createAccessToken,
  hashPassword,
  publicUser,
  verifyPassword,
} from './auth.js'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const usernamePattern = /^[a-z0-9._-]{3,32}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function register(request: Request, response: Response) {
  const body: unknown = request.body
  if (!isRecord(body)) {
    response.status(400).json({ message: 'Enter your name, email, username, and password.' })
    return
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (fullName.length < 1 || fullName.length > 100) {
    response.status(400).json({ message: 'Enter a name between 1 and 100 characters.' })
    return
  }
  if (email.length > 254 || !emailPattern.test(email)) {
    response.status(400).json({ message: 'Enter a valid email address.' })
    return
  }
  if (!usernamePattern.test(username)) {
    response.status(400).json({ message: 'Username must be 3–32 characters: lowercase letters, numbers, dots, underscores, or hyphens.' })
    return
  }
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    response.status(400).json({ message: 'Password must be at least 12 characters and no more than 72 UTF-8 bytes.' })
    return
  }

  try {
    const passwordHash = await hashPassword(password)
    const row = await createCustomer({ fullName, email, username, passwordHash })
    const user = publicUser(row)
    response.status(201).json({ user, token: createAccessToken(user) })
  } catch (error) {
    if (isRecord(error) && error.code === '23505') {
      response.status(409).json({ message: 'That email or username is already registered.' })
      return
    }
    throw error
  }
}

export async function login(request: Request, response: Response) {
  const body: unknown = request.body
  if (!isRecord(body)) {
    response.status(400).json({ message: 'Enter your username or email and password.' })
    return
  }
  const identifier = typeof body.usernameOrEmail === 'string'
    ? body.usernameOrEmail.trim().toLowerCase()
    : typeof body.username === 'string'
      ? body.username.trim().toLowerCase()
      : typeof body.email === 'string'
        ? body.email.trim().toLowerCase()
        : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!identifier || !password || Buffer.byteLength(password, 'utf8') > 72) {
    response.status(400).json({ message: 'Enter your username or email and password.' })
    return
  }

  const row = await findUserByLogin(identifier, identifier.includes('@'))
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    response.status(401).json({ message: 'The username/email or password is incorrect.' })
    return
  }

  const user = publicUser(row)
  response.json({ user, token: createAccessToken(user) })
}

export async function me(request: Request, response: Response) {
  const userId = request.authUser?.id
  if (!userId) {
    response.status(401).json({ message: 'Please sign in to continue.' })
    return
  }
  const row = await findUserById(userId)
  if (!row) {
    response.status(401).json({ message: 'Your account no longer exists. Please sign in again.' })
    return
  }
  response.json({ user: publicUser(row) })
}
