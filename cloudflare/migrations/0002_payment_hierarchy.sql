ALTER TABLE bookings ADD COLUMN customer_name TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN customer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN reference_number TEXT;
ALTER TABLE bookings ADD COLUMN payment_tier TEXT;
ALTER TABLE bookings ADD COLUMN base_resort_price REAL;
ALTER TABLE bookings ADD COLUMN base_deposit_amount REAL;
ALTER TABLE bookings ADD COLUMN gateway_fee_amount REAL;
ALTER TABLE bookings ADD COLUMN total_online_paid REAL;
ALTER TABLE bookings ADD COLUMN cash_balance_due REAL;
ALTER TABLE bookings ADD COLUMN paymongo_payment_id TEXT;
ALTER TABLE bookings ADD COLUMN paymongo_checkout_session_id TEXT;

UPDATE bookings
SET reference_number = COALESCE(reference_number, 'TRP-LEGACY-' || id),
    base_resort_price = COALESCE(base_resort_price, estimated_total),
    base_deposit_amount = COALESCE(base_deposit_amount, deposit_required),
    gateway_fee_amount = COALESCE(gateway_fee_amount, 0),
    total_online_paid = COALESCE(total_online_paid, 0),
    cash_balance_due = COALESCE(cash_balance_due, MAX(estimated_total - paid_amount, 0));

CREATE UNIQUE INDEX IF NOT EXISTS bookings_reference_number_idx
  ON bookings (reference_number);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_paymongo_payment_id_idx
  ON bookings (paymongo_payment_id)
  WHERE paymongo_payment_id IS NOT NULL;
