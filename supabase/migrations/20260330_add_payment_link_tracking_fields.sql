-- Migration: Add payment link tracking fields to bookings table
-- Purpose: Enable proper Pay by Link lifecycle tracking with explicit expiration
-- Date: 2026-03-30

-- Add payment link tracking columns
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_link_url TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_link_created_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_link_expires_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS expired_at TIMESTAMPTZ;

-- Create index for the expiration cron job:
-- finds pending_payment + unpaid bookings where link has expired
CREATE INDEX IF NOT EXISTS idx_bookings_payment_expiry
  ON bookings (status, payment_status, payment_link_expires_at)
  WHERE status = 'pending_payment' AND payment_status = 'unpaid';

-- Create index for calendar queries:
-- excludes cancelled/expired bookings efficiently
CREATE INDEX IF NOT EXISTS idx_bookings_calendar_status
  ON bookings (status)
  WHERE status NOT IN ('cancelled', 'expired');

COMMENT ON COLUMN bookings.payment_link_url IS 'Nexi Pay by Link URL sent to customer';
COMMENT ON COLUMN bookings.payment_link_created_at IS 'UTC timestamp when the payment link was generated';
COMMENT ON COLUMN bookings.payment_link_expires_at IS 'UTC timestamp when the payment link expires (created_at + 1h)';
COMMENT ON COLUMN bookings.paid_at IS 'UTC timestamp when payment was confirmed via Nexi callback';
COMMENT ON COLUMN bookings.expired_at IS 'UTC timestamp when booking was auto-expired by cron job';
