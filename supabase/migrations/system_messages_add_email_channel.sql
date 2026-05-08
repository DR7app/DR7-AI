-- system_messages: aggiungi canale email opzionale
--
-- Permette a Messaggi di Sistema Pro di inviare lo stesso template anche
-- via email (oltre a WhatsApp). Il body resta identico al WhatsApp; solo
-- il subject email e il toggle on/off sono per-template.
--
-- send_email   = se true, dopo il WhatsApp invia anche email via Resend
-- email_subject = oggetto email; se vuoto, fallback al `label` del template

ALTER TABLE system_messages
  ADD COLUMN IF NOT EXISTS send_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_subject text;

COMMENT ON COLUMN system_messages.send_email IS
  'Se true, send-whatsapp-notification.ts invia anche email (stesso body) dopo il WhatsApp.';
COMMENT ON COLUMN system_messages.email_subject IS
  'Oggetto email; se NULL/vuoto, send-whatsapp-notification usa il label del template.';
