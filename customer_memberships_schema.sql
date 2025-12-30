-- Create customer_memberships table
CREATE TABLE IF NOT EXISTS customer_memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  package_code TEXT NOT NULL, -- 'argento', 'oro', 'platino', etc.
  package_name TEXT NOT NULL, -- 'Argento', 'Oro', 'Platino'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'pending'
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  external_order_id TEXT,
  source TEXT DEFAULT 'dr7empire.com',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster lookups by client
CREATE INDEX IF NOT EXISTS idx_customer_memberships_client_id ON customer_memberships(client_id);

-- RLS Policies
ALTER TABLE customer_memberships ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users (admin/staff) to read all memberships
CREATE POLICY "Allow authenticated users to read memberships" 
ON customer_memberships FOR SELECT 
USING (auth.role() = 'authenticated');

-- Allow authenticated users to insert/update memberships (for syncing or manual edits)
CREATE POLICY "Allow authenticated users to insert memberships" 
ON customer_memberships FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated users to update memberships" 
ON customer_memberships FOR UPDATE 
USING (auth.role() = 'authenticated');
