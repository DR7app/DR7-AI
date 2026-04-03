-- Upgrade limitation_overrides: add draftSessionId, flowType, status, expiresAt, bookingId linking
-- Idempotent: each column addition guarded by IF NOT EXISTS

DO $$
BEGIN
  -- draft_session_id: ties override to a single booking form session (UUID generated per form open)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'limitation_overrides' AND column_name = 'draft_session_id'
  ) THEN
    ALTER TABLE limitation_overrides ADD COLUMN draft_session_id UUID;
  END IF;

  -- flow_type: 'booking_create' or 'booking_edit'
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'limitation_overrides' AND column_name = 'flow_type'
  ) THEN
    ALTER TABLE limitation_overrides ADD COLUMN flow_type TEXT DEFAULT 'booking_create';
  END IF;

  -- status: replaces boolean otp_verified + consumed_at logic with explicit states
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'limitation_overrides' AND column_name = 'status'
  ) THEN
    ALTER TABLE limitation_overrides ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'active', 'consumed', 'expired', 'revoked'));
  END IF;

  -- expires_at: TTL for the override after OTP verification (2h default)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'limitation_overrides' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE limitation_overrides ADD COLUMN expires_at TIMESTAMPTZ;
  END IF;

  -- updated_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'limitation_overrides' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE limitation_overrides ADD COLUMN updated_at TIMESTAMPTZ DEFAULT now();
  END IF;
END $$;

-- Backfill status for existing records
UPDATE limitation_overrides
SET status = CASE
  WHEN consumed_at IS NOT NULL THEN 'consumed'
  WHEN otp_verified = true THEN 'active'
  ELSE 'pending'
END
WHERE status = 'pending' AND (otp_verified = true OR consumed_at IS NOT NULL);

-- Index for session-scoped lookup
CREATE INDEX IF NOT EXISTS idx_limitation_overrides_session
  ON limitation_overrides (draft_session_id, limitation_code, status)
  WHERE status = 'active';

-- RLS policies for authenticated (read own overrides)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'limitation_overrides' AND policyname = 'limitation_overrides_authenticated_all'
  ) THEN
    CREATE POLICY limitation_overrides_authenticated_all ON limitation_overrides
      FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
