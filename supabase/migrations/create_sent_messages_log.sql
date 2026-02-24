-- Log of manually sent WhatsApp messages from Admin → Marketing → Messaggi di Sistema
CREATE TABLE IF NOT EXISTS sent_messages_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id UUID REFERENCES customers_extended(id) ON DELETE SET NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    message_text TEXT NOT NULL,
    template_label TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'sent',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sent_messages_log_sent_at ON sent_messages_log(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_sent_messages_log_customer_id ON sent_messages_log(customer_id);

ALTER TABLE sent_messages_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view sent_messages_log"
    ON sent_messages_log FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert sent_messages_log"
    ON sent_messages_log FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role full access sent_messages_log"
    ON sent_messages_log FOR ALL TO service_role
    USING (true) WITH CHECK (true);
