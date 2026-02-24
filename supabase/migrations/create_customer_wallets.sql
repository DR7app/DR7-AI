-- Customer Wallets: admin-managed credit wallet for customers
-- Run this migration in Supabase SQL Editor

-- Customer wallets table
CREATE TABLE IF NOT EXISTS customer_wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers_extended(id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  total_earned_cents integer NOT NULL DEFAULT 0,
  total_spent_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(customer_id)
);

-- Customer wallet transactions table
CREATE TABLE IF NOT EXISTS customer_wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('manual_credit', 'manual_debit', 'booking_payment', 'refund')),
  amount_cents integer NOT NULL,
  balance_after_cents integer NOT NULL,
  description text,
  admin_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_customer_wallets_customer_id ON customer_wallets(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_wallet_id ON customer_wallet_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_customer_wallet_transactions_created_at ON customer_wallet_transactions(created_at DESC);

-- RLS policies
ALTER TABLE customer_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin) full access
CREATE POLICY "Admin full access on customer_wallets"
  ON customer_wallets FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Admin full access on customer_wallet_transactions"
  ON customer_wallet_transactions FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
