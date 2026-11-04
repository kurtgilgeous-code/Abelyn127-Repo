import rateLimit from 'express-rate-limit'
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { login, me, register } from './authController.js'
import { authConfigurationError, requireAdmin, requireUser } from './auth.js'
import { checkDatabaseConnection } from './db.js'
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

const app = express()
const port = Number(process.env.PORT ?? 5000)
const production = process.env.NODE_ENV === 'production'
const staticDirectory = fileURLToPath(new URL('../../dist/', import.meta.url))

app.disable('x-powered-by')
if (production) app.set('trust proxy', 1)
app.use(express.json({ limit: '10kb' }))
app.use((request, response, next) => {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET' && request.get('origin')) {
    const allowedOrigins = production
      ? [
          ...(process.env.APP_ORIGIN ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
          process.env.RENDER_EXTERNAL_URL,
        ].filter((origin): origin is string => Boolean(origin))
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

app.get('/api/health', async (_request, response) => {
  const configurationError = authConfigurationError()
  const originConfigured = Boolean(process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || !production)
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

const paymentProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
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

app.post('/api/auth/register', requireAuthConfiguration, registerLimiter, register)
app.post('/api/auth/login', requireAuthConfiguration, loginLimiter, login)
app.get('/api/auth/me', requireAuthConfiguration, requireUser, me)
app.post('/api/auth/logout', (_request, response) => response.status(204).end())
app.get('/api/admin/me', requireAuthConfiguration, requireUser, requireAdmin, (request, response) => {
  response.json({ user: request.authUser })
})

app.post(
  '/api/bookings',
  requireAuthConfiguration,
  requireUser,
  paymentProofUpload.single('proof'),
  createCustomerBooking,
)
app.get('/api/bookings/mine', requireAuthConfiguration, requireUser, customerBookings)
app.post(
  '/api/bookings/:id/payment-proof',
  requireAuthConfiguration,
  requireUser,
  paymentProofUpload.single('proof'),
  submitPaymentProof,
)
app.get('/api/admin/bookings', requireAuthConfiguration, requireUser, requireAdmin, adminBookings)
app.patch('/api/admin/bookings/:id', requireAuthConfiguration, requireUser, requireAdmin, updateAdminBooking)
app.post('/api/admin/bookings/:id/payments/cash', requireAuthConfiguration, requireUser, requireAdmin, recordAdminCashPayment)
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
