-- Send-log per Messaggi di Sistema Pro
-- Garantisce che ogni template automatico venga inviato al massimo UNA volta
-- per booking. Letta dal cron process-scheduled-system-messages-cron prima
-- di inviare via send-whatsapp-notification.

CREATE TABLE IF NOT EXISTS system_message_send_log (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    system_message_id UUID NOT NULL REFERENCES system_messages(id) ON DELETE CASCADE,
    booking_id UUID NOT NULL,
    customer_phone TEXT,
    sent_at TIMESTAMPTZ DEFAULT now(),
    status TEXT NOT NULL DEFAULT 'sent',  -- 'sent' | 'error' | 'skipped'
    error TEXT,
    UNIQUE (system_message_id, booking_id)
);

CREATE INDEX IF NOT EXISTS idx_smsl_message ON system_message_send_log(system_message_id);
CREATE INDEX IF NOT EXISTS idx_smsl_booking ON system_message_send_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_smsl_sent_at ON system_message_send_log(sent_at DESC);

-- RLS: solo lettura agli admin loggati, scrittura solo via service role.
ALTER TABLE system_message_send_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read send_log" ON system_message_send_log;
CREATE POLICY "auth read send_log" ON system_message_send_log
    FOR SELECT USING (auth.role() = 'authenticated');

COMMENT ON TABLE system_message_send_log IS 'Dedup log per scheduled system_messages. UNIQUE (system_message_id, booking_id).';
