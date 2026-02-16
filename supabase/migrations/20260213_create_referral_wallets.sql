-- ============================================================
-- DR7 Referral + Wallet System
-- Migration: 20260213_create_referral_wallets.sql
-- ============================================================

-- Helper: generate unique referral code DR7-XXXXXX
CREATE OR REPLACE FUNCTION generate_referral_code()
RETURNS text AS $$
DECLARE
  code text;
  exists_already boolean;
BEGIN
  LOOP
    code := 'DR7-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    SELECT EXISTS(SELECT 1 FROM referral_participants WHERE referral_code = code) INTO exists_already;
    IF NOT exists_already THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 1. referral_participants
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cognome text NOT NULL,
  telefono text NOT NULL,
  email text,
  referral_code text NOT NULL DEFAULT generate_referral_code(),
  referred_by uuid REFERENCES referral_participants(id),
  phone_verified boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
  registration_ip text,
  device_fingerprint text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_participants_telefono ON referral_participants(telefono);
CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_participants_code ON referral_participants(referral_code);
CREATE INDEX IF NOT EXISTS idx_referral_participants_referred_by ON referral_participants(referred_by);
CREATE INDEX IF NOT EXISTS idx_referral_participants_status ON referral_participants(status);

-- ============================================================
-- 2. wallets
-- ============================================================
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL UNIQUE REFERENCES referral_participants(id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  total_earned_cents integer NOT NULL DEFAULT 0,
  total_spent_cents integer NOT NULL DEFAULT 0,
  total_topped_up_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallets_participant ON wallets(participant_id);

-- ============================================================
-- 3. wallet_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'registration_bonus',
    'referral_friend_topup',
    'milestone_10_friends',
    'topup',
    'booking_payment',
    'manual_credit',
    'manual_debit',
    'refund'
  )),
  amount_cents integer NOT NULL, -- positive = credit, negative = debit
  balance_after_cents integer NOT NULL,
  description text,
  metadata jsonb DEFAULT '{}',
  admin_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet ON wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_type ON wallet_transactions(type);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created ON wallet_transactions(created_at DESC);

-- ============================================================
-- 4. otp_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telefono text NOT NULL,
  code text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_codes_telefono ON otp_codes(telefono);
CREATE INDEX IF NOT EXISTS idx_otp_codes_expires ON otp_codes(expires_at);

-- ============================================================
-- 5. wallet_topups
-- ============================================================
CREATE TABLE IF NOT EXISTS wallet_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES referral_participants(id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  nexi_order_id text,
  payment_link text,
  referrer_bonus_granted boolean NOT NULL DEFAULT false,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_participant ON wallet_topups(participant_id);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_nexi_order ON wallet_topups(nexi_order_id);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_status ON wallet_topups(status);

-- ============================================================
-- 6. referral_milestones
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES referral_participants(id) ON DELETE CASCADE,
  milestone_number integer NOT NULL, -- 1 = first 10, 2 = second 10, etc.
  qualifying_referrals integer NOT NULL, -- snapshot of count at time of milestone
  bonus_cents integer NOT NULL, -- 55000 = €550
  transaction_id uuid REFERENCES wallet_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id, milestone_number)
);

CREATE INDEX IF NOT EXISTS idx_referral_milestones_participant ON referral_milestones(participant_id);

-- ============================================================
-- 7. referral_discount_codes (buoni sconto monouso)
-- ============================================================
CREATE TABLE IF NOT EXISTS referral_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES referral_participants(id) ON DELETE CASCADE,
  code text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason text NOT NULL CHECK (reason IN ('registration', 'friend_topup', 'milestone')),
  scope text[] NOT NULL DEFAULT ARRAY['noleggio', 'supercar'],
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz,
  booking_id uuid,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referral_discount_codes_code ON referral_discount_codes(code);
CREATE INDEX IF NOT EXISTS idx_referral_discount_codes_participant ON referral_discount_codes(participant_id);
CREATE INDEX IF NOT EXISTS idx_referral_discount_codes_used ON referral_discount_codes(used);

-- Helper: generate unique buono sconto code BUONO-XXXXXXXX
CREATE OR REPLACE FUNCTION generate_buono_code()
RETURNS text AS $$
DECLARE
  code text;
  charset text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  exists_already boolean;
  i integer;
BEGIN
  LOOP
    code := 'BUONO-';
    FOR i IN 1..8 LOOP
      IF i = 5 THEN
        code := code || '-';
      END IF;
      code := code || substr(charset, floor(random() * length(charset) + 1)::int, 1);
    END LOOP;
    SELECT EXISTS(SELECT 1 FROM referral_discount_codes WHERE referral_discount_codes.code = generate_buono_code.code) INTO exists_already;
    IF NOT exists_already THEN
      RETURN code;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Stats view: referral_program_stats
-- ============================================================
CREATE OR REPLACE VIEW referral_program_stats AS
SELECT
  (SELECT count(*) FROM referral_participants WHERE status = 'active') AS total_participants,
  (SELECT count(*) FROM referral_participants WHERE referred_by IS NOT NULL) AS total_referred,
  (SELECT coalesce(sum(balance_cents), 0) FROM wallets) AS outstanding_balance_cents,
  (SELECT coalesce(sum(total_earned_cents), 0) FROM wallets) AS total_credits_distributed_cents,
  (SELECT coalesce(sum(amount_cents), 0) FROM wallet_topups WHERE status = 'completed') AS total_topups_cents,
  (SELECT count(*) FROM wallet_topups WHERE status = 'completed') AS total_topup_count,
  (SELECT count(DISTINCT participant_id) FROM wallet_topups WHERE status = 'completed') AS participants_with_topups,
  (SELECT count(*) FROM referral_discount_codes) AS total_buoni_generated,
  (SELECT count(*) FROM referral_discount_codes WHERE used = true) AS total_buoni_used,
  (SELECT count(*) FROM referral_discount_codes WHERE used = false AND expires_at > now()) AS total_buoni_active,
  (SELECT coalesce(sum(amount_cents), 0) FROM referral_discount_codes WHERE used = false AND expires_at > now()) AS total_buoni_value_cents;

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE referral_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_discount_codes ENABLE ROW LEVEL SECURITY;

-- Service role (Netlify functions) gets full access
CREATE POLICY "Service role full access on referral_participants"
  ON referral_participants FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallets"
  ON wallets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_transactions"
  ON wallet_transactions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on otp_codes"
  ON otp_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on wallet_topups"
  ON wallet_topups FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Service role full access on referral_milestones"
  ON referral_milestones FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Authenticated users (admin panel) can read
CREATE POLICY "Authenticated read on referral_participants"
  ON referral_participants FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on wallets"
  ON wallets FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on wallet_transactions"
  ON wallet_transactions FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on wallet_topups"
  ON wallet_topups FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated read on referral_milestones"
  ON referral_milestones FOR SELECT
  USING (auth.role() = 'authenticated');

-- referral_discount_codes policies
CREATE POLICY "Service role full access on referral_discount_codes"
  ON referral_discount_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Authenticated read on referral_discount_codes"
  ON referral_discount_codes FOR SELECT
  USING (auth.role() = 'authenticated');
