-- Switch the online payment gateway from PayMongo to HitPay.
-- Columns are renamed to provider-neutral names; existing values are kept.
DROP INDEX IF EXISTS bookings_paymongo_payment_id_idx;
ALTER TABLE bookings RENAME COLUMN paymongo_payment_id TO gateway_payment_id;
ALTER TABLE bookings RENAME COLUMN paymongo_checkout_session_id TO gateway_checkout_id;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_gateway_payment_id_idx
  ON bookings (gateway_payment_id)
  WHERE gateway_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_gateway_checkout_id_idx
  ON bookings (gateway_checkout_id)
  WHERE gateway_checkout_id IS NOT NULL;
