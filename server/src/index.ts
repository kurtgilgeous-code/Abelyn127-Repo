import rateLimit from 'express-rate-limit'
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { login, me, register } from './authController.js'
import { authConfigurationError, requireAdmin, requireUser } from './auth.js'
import { checkDatabaseConnection, expirePendingHolds, hasActivePendingHold, isAccommodationAvailable, isStayBlocked } from './db.js'
import {
  addBlockedDate,
  adminBlockedDates,
  adminUsers,
  removeAdminUser,
  removeBlockedDate,
  rescheduleAdminBooking,
} from './adminController.js'
import multer from 'multer'
import {
  adminBookings,
  adminPaymentProof,
  createCustomerBooking,
  customerBookings,
  recordAdminCashPayment,
  reviewAdminPayment,
  submitPaymentProof,
  updateAdminBooking,
} from './bookingController.js'
import {
  confirmHoldWithCash,
  createPendingHoldBooking,
  createWalkInBooking,
} from './paymentsController.js'
import { geraintChat } from './chatController.js'
import { parseAccommodationIds } from './pricing.js'

const app = express()
const port = Number(process.env.PORT ?? 5000)
const production = process.env.NODE_ENV === 'production'
const staticDirectory = fileURLToPath(new URL('../../dist/', import.meta.url))

app.disable('x-powered-by')
if (production) app.set('trust proxy', 1)
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET' && request.get('origin')) {
    const allowedOrigins = production
      ? [
          ...(process.env.APP_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
        ]
      : ['http://localhost:5173', 'http://127.0.0.1:5173']
    const requestOrigin = request.get('origin') ?? ''
    const isLocalDevelopmentOrigin = !production && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(requestOrigin)
    if (!allowedOrigins.includes(requestOrigin) && !isLocalDevelopmentOrigin) {
      response.status(403).json({ message: 'Request origin is not allowed.' })
      return
    }
  }
  next()
})
app.use(express.json({ limit: '10kb' }))

app.get('/api/health', async (_request, response) => {
  const configurationError = authConfigurationError()
  const originConfigured = Boolean(process.env.APP_ORIGIN || !production)
  let databaseConnected = false
  if (!configurationError) {
    try {
      databaseConnected = await checkDatabaseConnection()
    } catch (error) {
      console.error('Health check could not reach PostgreSQL:', error)
    }
  }
  const healthy = !configurationError && databaseConnected && originConfigured
  response.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'unavailable',
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    databaseConnected,
    jwtConfigured: Boolean(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, 'utf8') >= 32),
    originConfigured,
  })
})

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Too many sign-in attempts. Wait 15 minutes before trying again.' },
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many account creation attempts. Try again later.' },
})

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Woof! Geraint needs a quick breather. Please wait a minute before sending more messages.' },
})

const holdLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many hold requests. Please try again later.' },
})

const gcashProofLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Too many payment uploads. Please try again later.' },
})

const paymentProofUpload = multer({
  storage: multer.memoryStorage(),
  // One screenshot plus a handful of short text fields (the booking JSON is capped at 10 KB).
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 10, fieldSize: 10 * 1024, parts: 11 },
  fileFilter: (_request, file, callback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(null, true)
      return
    }
    callback(new Error('Payment proof must be a PNG, JPEG, or WebP image.'))
  },
})

function requireAuthConfiguration(
  _request: Request,
  response: Response,
  next: NextFunction,
) {
  const message = authConfigurationError()
  if (message) {
    response.status(503).json({ message })
    return
  }
  next()
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

app.get('/api/availability', async (request, response) => {
  // ?accommodationIds=bahay-hapag,balai-delnor (one booking can combine several), or the
  // older single ?accommodationId=...
  const rawIds = request.query.accommodationIds ?? request.query.accommodationId
  const accommodationIds = typeof rawIds === 'string'
    ? parseAccommodationIds({ accommodationIds: rawIds.split(',').map((id) => id.trim()) })
    : null
  const checkInDate = request.query.checkInDate
  const checkOutDate = request.query.checkOutDate
  if (
    !accommodationIds ||
    !validDate(checkInDate) || !validDate(checkOutDate) || checkOutDate <= checkInDate
  ) {
    response.status(400).json({ message: 'Choose a valid accommodation and date range.' })
    return
  }
  await expirePendingHolds()
  const [available, pendingHold, blocked] = await Promise.all([
    isAccommodationAvailable(accommodationIds, checkInDate, checkOutDate),
    hasActivePendingHold(accommodationIds, checkInDate, checkOutDate),
    isStayBlocked(accommodationIds, checkInDate, checkOutDate),
  ])
  // blocked: the resort closed these dates (maintenance / private use); available is false too.
  response.json({ available, pendingHold, blocked })
})

app.post('/api/auth/register', requireAuthConfiguration, registerLimiter, register)
app.post('/api/auth/login', requireAuthConfiguration, loginLimiter, login)
app.post('/api/chat', chatLimiter, geraintChat)
app.get('/api/auth/me', requireAuthConfiguration, requireUser, me)
app.post('/api/auth/logout', (_request, response) => response.status(204).end())
app.get('/api/admin/me', requireAuthConfiguration, requireUser, requireAdmin, (request, response) => {
  response.json({ user: request.authUser })
})

app.post(
  '/api/bookings',
  requireAuthConfiguration,
  requireUser,
  gcashProofLimiter,
  paymentProofUpload.single('proof'),
  createCustomerBooking,
)
app.post('/api/bookings/pending-hold', requireAuthConfiguration, requireUser, holdLimiter, createPendingHoldBooking)
app.get('/api/bookings/mine', requireAuthConfiguration, requireUser, customerBookings)
app.post(
  '/api/bookings/:id/payment-proof',
  requireAuthConfiguration,
  requireUser,
  gcashProofLimiter,
  paymentProofUpload.single('proof'),
  submitPaymentProof,
)
app.get('/api/admin/bookings', requireAuthConfiguration, requireUser, requireAdmin, adminBookings)
app.post('/api/admin/bookings/walk-in', requireAuthConfiguration, requireUser, requireAdmin, createWalkInBooking)
app.patch('/api/admin/bookings/:id', requireAuthConfiguration, requireUser, requireAdmin, updateAdminBooking)
app.post('/api/admin/bookings/:id/payments/cash', requireAuthConfiguration, requireUser, requireAdmin, recordAdminCashPayment)
app.post('/api/admin/bookings/:id/confirm-hold-cash', requireAuthConfiguration, requireUser, requireAdmin, confirmHoldWithCash)
app.patch('/api/admin/bookings/:id/reschedule', requireAuthConfiguration, requireUser, requireAdmin, rescheduleAdminBooking)
app.get('/api/admin/users', requireAuthConfiguration, requireUser, requireAdmin, adminUsers)
app.delete('/api/admin/users/:id', requireAuthConfiguration, requireUser, requireAdmin, removeAdminUser)
app.get('/api/admin/blocked-dates', requireAuthConfiguration, requireUser, requireAdmin, adminBlockedDates)
app.post('/api/admin/blocked-dates', requireAuthConfiguration, requireUser, requireAdmin, addBlockedDate)
app.delete('/api/admin/blocked-dates/:id', requireAuthConfiguration, requireUser, requireAdmin, removeBlockedDate)
app.patch('/api/admin/bookings/:id/payments/:paymentId', requireAuthConfiguration, requireUser, requireAdmin, reviewAdminPayment)
app.get(
  '/api/admin/bookings/:id/payments/:paymentId/proof',
  requireAuthConfiguration,
  requireUser,
  requireAdmin,
  adminPaymentProof,
)

const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof multer.MulterError) {
    response.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      message: error.code === 'LIMIT_FILE_SIZE'
        ? 'Payment screenshot must be 5 MB or smaller.'
        : 'Upload one payment screenshot at a time.',
    })
    return
  }
  // body-parser errors: answer with the right status instead of a generic 500.
  const bodyErrorType = typeof error === 'object' && error !== null && 'type' in error ? error.type : ''
  if (bodyErrorType === 'entity.too.large') {
    response.status(413).json({ message: 'Request body must be 10 KB or smaller.' })
    return
  }
  if (bodyErrorType === 'entity.parse.failed') {
    response.status(400).json({ message: 'Request body is not valid JSON.' })
    return
  }
  if (error instanceof Error && error.message === 'Payment proof must be a PNG, JPEG, or WebP image.') {
    response.status(400).json({ message: error.message })
    return
  }
  console.error('Unhandled API error:', error)
  response.status(500).json({ message: 'The server could not complete the request.' })
}
if (production) {
  app.use(express.static(staticDirectory, { index: false, maxAge: '1h' }))
  app.get('/{*path}', (request, response, next) => {
    if (request.path.startsWith('/api/')) {
      response.status(404).json({ message: 'API route not found.' })
      return
    }
    response.sendFile(path.join(staticDirectory, 'index.html'), (error) => {
      if (error) next(error)
    })
  })
}

app.use(errorHandler)

app.listen(port, '0.0.0.0', () => {
  console.log(`Tampisawan API listening on http://localhost:${port}`)
})

// Holds also expire on every bookings/availability read; this sweep keeps the database
// current even when nobody is browsing (the Cloudflare Worker uses a cron trigger instead).
const holdExpirySweep = setInterval(() => {
  expirePendingHolds()
    .then((expired) => { if (expired) console.log(`Expired ${expired} unpaid voucher(s) or checkout(s).`) })
    .catch((error: unknown) => console.error('Pending-hold expiry sweep failed:', error))
}, 15 * 60 * 1000)
holdExpirySweep.unref()
