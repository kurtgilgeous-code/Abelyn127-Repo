CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'CUSTOMER')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  accommodation_id TEXT NOT NULL,
  accommodation_name TEXT NOT NULL,
  tour_type TEXT NOT NULL CHECK (tour_type IN ('OVERNIGHT', 'DAY_TOUR', 'NIGHT_TOUR')),
  check_in_date TEXT NOT NULL,
  check_out_date TEXT NOT NULL CHECK (check_out_date > check_in_date),
  adults INTEGER NOT NULL CHECK (adults >= 0),
  seniors_pwd INTEGER NOT NULL CHECK (seniors_pwd >= 0),
  children INTEGER NOT NULL CHECK (children >= 0),
  guest_count INTEGER NOT NULL CHECK (guest_count > 0),
  estimated_total REAL NOT NULL CHECK (estimated_total >= 0),
  deposit_required REAL NOT NULL CHECK (deposit_required >= 0),
  payment_amount REAL,
  paid_amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'DATE_UNAVAILABLE')),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PENDING_REVIEW', 'PARTIALLY_PAID', 'PAID', 'NOT_PAID', 'VOID')),
  payment_method TEXT CHECK (payment_method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER', 'CASH')),
  payment_reference TEXT NOT NULL DEFAULT '',
  proof_storage_key TEXT,
  proof_file_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS booking_payments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER', 'CASH')),
  reference TEXT NOT NULL DEFAULT '',
  payer_account TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('CUSTOMER', 'ADMIN_CASH')),
  status TEXT NOT NULL CHECK (status IN ('PENDING_REVIEW', 'RECEIVED', 'NOT_RECEIVED')),
  proof_storage_key TEXT,
  proof_file_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  verified_at TEXT
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS booking_payments_booking_created_idx
  ON booking_payments (booking_id, created_at);
CREATE INDEX IF NOT EXISTS bookings_user_created_idx
  ON bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_created_idx
  ON bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_overlap_idx
  ON bookings (accommodation_id, status, check_in_date, check_out_date);
