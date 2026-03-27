-- Add email column to user_credit_balance so credit can be stored before account creation
ALTER TABLE user_credit_balance ADD COLUMN IF NOT EXISTS email TEXT;

-- Make user_id nullable (so we can store by email only)
ALTER TABLE user_credit_balance ALTER COLUMN user_id DROP NOT NULL;

-- Add email column to credit_transactions too
ALTER TABLE credit_transactions ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE credit_transactions ALTER COLUMN user_id DROP NOT NULL;

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_user_credit_balance_email ON user_credit_balance(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_credit_transactions_email ON credit_transactions(email) WHERE email IS NOT NULL;
