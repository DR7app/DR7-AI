-- Dedupe column for the supercar rental-extension reminder.
-- The cron `rental-extension-supercar-cron` only sends to bookings where
-- this column is still NULL, then stamps it on send to prevent re-sends.
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS extension_reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_bookings_extension_reminder_pending
    ON bookings (dropoff_date)
    WHERE extension_reminder_sent_at IS NULL;
