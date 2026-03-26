-- Log every card type detection attempt (blocked or allowed)
CREATE TABLE IF NOT EXISTS blocked_card_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  booking_id UUID,
  customer_id TEXT,
  customer_name TEXT,
  customer_email TEXT,
  card_type TEXT,
  card_circuit TEXT,
  masked_pan TEXT,
  bin_type TEXT,
  operation_type TEXT,
  result TEXT NOT NULL,
  nexi_order_id TEXT,
  nexi_operation_id TEXT,
  details JSONB
);

CREATE INDEX IF NOT EXISTS idx_blocked_card_attempts_created ON blocked_card_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_blocked_card_attempts_result ON blocked_card_attempts(result);
