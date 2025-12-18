-- Add alarm tracking to bookings table
-- This column tracks when an alarm has been triggered for a booking
-- to prevent duplicate alarms across sessions and devices

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS alarm_triggered_at TIMESTAMPTZ;

-- Add index for efficient querying of bookings that haven't triggered alarms
CREATE INDEX IF NOT EXISTS idx_bookings_alarm_triggered 
ON bookings(alarm_triggered_at) 
WHERE alarm_triggered_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN bookings.alarm_triggered_at IS 'Timestamp when the vehicle return alarm was triggered for this booking';
