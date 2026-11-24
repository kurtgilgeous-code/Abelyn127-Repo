-- 2-tier first-come, first-served reservations with 24-hour pending cash holds.
--
-- SQLite cannot change CHECK constraints in place, so the bookings table is rebuilt with the
-- new statuses (PENDING_HOLD, EXPIRED, CANCELLED_BY_GCASH_PRIORITY) and the new
-- columns expires_at, priority_rank and hold_reference_number.
--
-- Payment records must survive: dropping a parent table runs an implicit DELETE that
-- fires ON DELETE CASCADE in any table whose foreign key names it. So payments are first
-- copied to a backup table with NO foreign key, the old tables are dropped, the new
-- bookings table takes the name "bookings", and only then is booking_payments recreated
-- (pointing at the new table) and refilled from the backup.
PRAGMA defer_foreign_keys = true;

CREATE TABLE bookings_new (
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
    CHECK (status IN (
      'PENDING', 'CONFIRMED', 'CANCELLED', 'DATE_UNAVAILABLE',
      'PENDING_HOLD', 'EXPIRED', 'CANCELLED_BY_GCASH_PRIORITY'
    )),
  payment_status TEXT NOT NULL DEFAULT 'UNPAID'
    CHECK (payment_status IN ('UNPAID', 'PENDING_REVIEW', 'PARTIALLY_PAID', 'PAID', 'NOT_PAID', 'VOID')),
  payment_method TEXT CHECK (payment_method IN ('GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER', 'CASH')),
  payment_reference TEXT NOT NULL DEFAULT '',
  proof_storage_key TEXT,
  proof_file_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  customer_name TEXT NOT NULL DEFAULT '',
  customer_email TEXT NOT NULL DEFAULT '',
  reference_number TEXT,
  payment_tier TEXT CHECK (payment_tier IS NULL OR payment_tier IN (
    'ONLINE_GCASH_RESERVATION', 'WALKIN_CASH_NO_RESERVATION', 'PENDING_CASH_INQUIRY'
  )),
  base_resort_price REAL,
  base_deposit_amount REAL,
  gateway_fee_amount REAL,
  total_online_paid REAL,
  cash_balance_due REAL,
  gateway_payment_id TEXT,
  gateway_checkout_id TEXT,
  expires_at TEXT,
  priority_rank INTEGER CHECK (priority_rank IS NULL OR priority_rank IN (1, 2)),
  hold_reference_number TEXT
);

INSERT INTO bookings_new (
  id, user_id, accommodation_id, accommodation_name, tour_type, check_in_date, check_out_date,
  adults, seniors_pwd, children, guest_count, estimated_total, deposit_required,
  payment_amount, paid_amount, status, payment_status, payment_method, payment_reference,
  proof_storage_key, proof_file_name, created_at, customer_name, customer_email,
  reference_number, payment_tier, base_resort_price, base_deposit_amount,
  gateway_fee_amount, total_online_paid, cash_balance_due, gateway_payment_id,
  gateway_checkout_id, expires_at, priority_rank, hold_reference_number
)
SELECT
  id, user_id, accommodation_id, accommodation_name, tour_type, check_in_date, check_out_date,
  adults, seniors_pwd, children, guest_count, estimated_total, deposit_required,
  payment_amount, paid_amount, status, payment_status, payment_method, payment_reference,
  proof_storage_key, proof_file_name, created_at, customer_name, customer_email,
  reference_number, payment_tier, base_resort_price, base_deposit_amount,
  gateway_fee_amount, total_online_paid, cash_balance_due, gateway_payment_id,
  gateway_checkout_id, NULL,
  CASE WHEN payment_tier IN ('ONLINE_GCASH_RESERVATION', 'WALKIN_CASH_NO_RESERVATION') THEN 1 END,
  NULL
FROM bookings;

CREATE TABLE booking_payments_backup AS SELECT
  id, booking_id, amount, method, reference, payer_account, source, status,
  proof_storage_key, proof_file_name, created_at, verified_at
FROM booking_payments;

DROP TABLE booking_payments;
DROP TABLE bookings;
ALTER TABLE bookings_new RENAME TO bookings;

CREATE TABLE booking_payments (
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

INSERT INTO booking_payments (
  id, booking_id, amount, method, reference, payer_account, source, status,
  proof_storage_key, proof_file_name, created_at, verified_at
)
SELECT
  id, booking_id, amount, method, reference, payer_account, source, status,
  proof_storage_key, proof_file_name, created_at, verified_at
FROM booking_payments_backup;

DROP TABLE booking_payments_backup;

CREATE INDEX booking_payments_booking_created_idx ON booking_payments (booking_id, created_at);
CREATE INDEX bookings_user_created_idx ON bookings (user_id, created_at DESC);
CREATE INDEX bookings_created_idx ON bookings (created_at DESC);
CREATE INDEX bookings_overlap_idx ON bookings (accommodation_id, status, check_in_date, check_out_date);
CREATE UNIQUE INDEX bookings_reference_number_idx ON bookings (reference_number);
CREATE UNIQUE INDEX bookings_gateway_payment_id_idx
  ON bookings (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX bookings_gateway_checkout_id_idx
  ON bookings (gateway_checkout_id) WHERE gateway_checkout_id IS NOT NULL;
CREATE INDEX bookings_pending_hold_expiry_idx
  ON bookings (expires_at) WHERE status = 'PENDING_HOLD';
