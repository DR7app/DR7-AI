-- Add automation fields to system_messages
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS is_automatic BOOLEAN DEFAULT false;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS is_enabled BOOLEAN DEFAULT true;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS trigger_event TEXT DEFAULT 'before_dropoff';
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS trigger_offset_hours INTEGER DEFAULT 24;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS send_hour INTEGER DEFAULT 9;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_category TEXT DEFAULT 'all';
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS target_status TEXT DEFAULT 'confirmed,active';

-- trigger_event values:
--   'before_pickup'   = X hours before pickup
--   'after_pickup'    = X hours after pickup
--   'before_dropoff'  = X hours before dropoff (return)
--   'after_dropoff'   = X hours after dropoff
--   'on_booking'      = when booking is created
--   'on_payment'      = when payment is received

-- trigger_offset_hours: positive = before event, negative = after event
--   24 = 1 day before
--   48 = 2 days before
--   1  = 1 hour before
--   -1 = 1 hour after
--   -60 = 60 minutes after (use with after_dropoff for deposit return)

-- send_hour: Rome timezone hour (0-23), null = send immediately when condition is met
-- target_category: 'all', 'exotic', 'urban', 'aziendali', 'furgone'
-- target_status: comma-separated booking statuses, e.g. 'confirmed,active'

COMMENT ON COLUMN system_messages.is_automatic IS 'If true, message is sent automatically by cron';
COMMENT ON COLUMN system_messages.is_enabled IS 'If false, message is disabled (not sent)';
COMMENT ON COLUMN system_messages.trigger_event IS 'Event that triggers the message';
COMMENT ON COLUMN system_messages.trigger_offset_hours IS 'Hours offset from trigger event';
COMMENT ON COLUMN system_messages.send_hour IS 'Hour (Rome timezone) to send, null = immediate';
COMMENT ON COLUMN system_messages.target_category IS 'Vehicle category filter';
COMMENT ON COLUMN system_messages.target_status IS 'Comma-separated booking statuses';

-- Update existing templates with their current automation settings
UPDATE system_messages SET
  is_automatic = true,
  is_enabled = true,
  trigger_event = 'before_dropoff',
  trigger_offset_hours = 24,
  send_hour = 9,
  target_category = 'exotic'
WHERE message_key = 'supercar_day_before';

UPDATE system_messages SET
  is_automatic = true,
  is_enabled = true,
  trigger_event = 'before_dropoff',
  trigger_offset_hours = 24,
  send_hour = 9,
  target_category = 'urban'
WHERE message_key = 'utilitaria_day_before';

UPDATE system_messages SET
  is_automatic = true,
  is_enabled = true,
  trigger_event = 'after_dropoff',
  trigger_offset_hours = 1,
  send_hour = null,
  target_category = 'all'
WHERE message_key = 'deposit_return_iban';
