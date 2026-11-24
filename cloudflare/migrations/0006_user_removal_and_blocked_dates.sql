-- Safe user removal + manual date blocking.
--
-- 1. bookings.user_id becomes nullable with ON DELETE SET NULL, so deleting an account never
--    fails on the foreign key and never erases bookings or payment (revenue) history.
--    SQLite can't alter a foreign key in place, so bookings is rebuilt. As in 0004, payments
--    are first copied to a backup table with NO foreign key: dropping the old bookings table
--    runs an implicit DELETE that would otherwise cascade into booking_payments.
-- 2. blocked_dates lets the admin close dates (whole resort or chosen accommodations) for
--    maintenance, weather, or private owner use.
PRAGMA defer_foreign_keys = true;

CREATE TABLE bookings_new (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
  hold_reference_number TEXT,
  accommodation_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(accommodation_ids) AND json_type(accommodation_ids) = 'array')
);

-- Keep the customer's name and email on each booking, so records stay readable after the
-- account is removed.
INSERT INTO bookings_new (
  id, user_id, accommodation_id, accommodation_name, tour_type, check_in_date, check_out_date,
  adults, seniors_pwd, children, guest_count, estimated_total, deposit_required,
  payment_amount, paid_amount, status, payment_status, payment_method, payment_reference,
  proof_storage_key, proof_file_name, created_at, customer_name, customer_email,
  reference_number, payment_tier, base_resort_price, base_deposit_amount,
  gateway_fee_amount, total_online_paid, cash_balance_due, gateway_payment_id,
  gateway_checkout_id, expires_at, priority_rank, hold_reference_number, accommodation_ids
)
SELECT
  b.id, b.user_id, b.accommodation_id, b.accommodation_name, b.tour_type, b.check_in_date, b.check_out_date,
  b.adults, b.seniors_pwd, b.children, b.guest_count, b.estimated_total, b.deposit_required,
  b.payment_amount, b.paid_amount, b.status, b.payment_status, b.payment_method, b.payment_reference,
  b.proof_storage_key, b.proof_file_name, b.created_at,
  COALESCE(NULLIF(b.customer_name, ''), u.full_name, ''),
  COALESCE(NULLIF(b.customer_email, ''), u.email, ''),
  b.reference_number, b.payment_tier, b.base_resort_price, b.base_deposit_amount,
  b.gateway_fee_amount, b.total_online_paid, b.cash_balance_due, b.gateway_payment_id,
  b.gateway_checkout_id, b.expires_at, b.priority_rank, b.hold_reference_number, b.accommodation_ids
FROM bookings b
LEFT JOIN users u ON u.id = b.user_id;

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

-- accommodation_ids: JSON array; '[]' closes the whole resort.
-- end_date is exclusive, like bookings.check_out_date.
CREATE TABLE blocked_dates (
  id TEXT PRIMARY KEY,
  accommodation_ids TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(accommodation_ids) AND json_type(accommodation_ids) = 'array'),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL CHECK (end_date > start_date),
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX blocked_dates_range_idx ON blocked_dates (start_date, end_date);
