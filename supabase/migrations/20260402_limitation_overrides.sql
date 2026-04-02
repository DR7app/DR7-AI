-- Limitation Override via OTP
-- Tracks director-approved overrides for specific business rule limitations.
-- Each override is scoped to one limitation + one booking/action context.

CREATE TABLE IF NOT EXISTS limitation_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limitation_code TEXT NOT NULL,          -- e.g. 'license_too_recent', 'pickup_in_past'
  booking_id UUID,                        -- NULL if override is pre-booking
  action_context TEXT,                    -- free-form key for non-booking actions
  otp_code TEXT NOT NULL,
  otp_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  otp_expires_at TIMESTAMPTZ NOT NULL,
  otp_verified BOOLEAN NOT NULL DEFAULT false,
  otp_attempts INT NOT NULL DEFAULT 0,
  approved_at TIMESTAMPTZ,
  consumed_at TIMESTAMPTZ,
  approved_by_user_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast lookup by limitation + context
CREATE INDEX IF NOT EXISTS idx_limitation_overrides_lookup
  ON limitation_overrides (limitation_code, action_context, otp_verified)
  WHERE consumed_at IS NULL;

-- RLS
ALTER TABLE limitation_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE limitation_overrides FORCE ROW LEVEL SECURITY;

-- Service role can do everything (Netlify functions use service_role)
-- No anon access needed
