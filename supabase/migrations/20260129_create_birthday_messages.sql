-- Create birthday_messages table to track birthday greetings sent
CREATE TABLE IF NOT EXISTS birthday_messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES customers_extended(id) ON DELETE CASCADE,
    year integer NOT NULL,
    sent_at timestamp with time zone DEFAULT now(),
    message_text text,
    sent_via text DEFAULT 'whatsapp',
    created_at timestamp with time zone DEFAULT now()
);

-- Create unique index to ensure only one message per customer per year
CREATE UNIQUE INDEX IF NOT EXISTS idx_birthday_messages_customer_year
ON birthday_messages(customer_id, year);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_birthday_messages_year ON birthday_messages(year);
CREATE INDEX IF NOT EXISTS idx_birthday_messages_customer_id ON birthday_messages(customer_id);

-- Enable Row Level Security
ALTER TABLE birthday_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all birthday messages
CREATE POLICY "Authenticated users can view birthday messages"
    ON birthday_messages
    FOR SELECT
    TO authenticated
    USING (true);

-- Policy: Authenticated users can insert birthday messages
CREATE POLICY "Authenticated users can insert birthday messages"
    ON birthday_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

-- Policy: Service role has full access
CREATE POLICY "Service role has full access to birthday messages"
    ON birthday_messages
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
