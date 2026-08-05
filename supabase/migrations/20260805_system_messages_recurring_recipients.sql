-- Messaggi di Sistema Pro — autonomia totale (fase 1)
--
-- PROBLEMA: ogni messaggio automatico poteva essere programmato SOLO in
-- rapporto a una prenotazione (X ore prima/dopo ritiro, riconsegna, firma...).
-- Non esisteva modo di dire "ogni sabato alle 18:30" ne' di scegliere il
-- destinatario: il cron mandava sempre al cliente della pratica, e gli unici
-- destinatari diversi (autista, staff cauzioni) erano hardcoded nel codice.
--
-- SOLUZIONE:
--   1. trigger_event = 'on_schedule' → programmazione RICORRENTE a calendario
--      (giorni della settimana + ora:minuti Roma + intervallo di date),
--      completamente slegata dalle prenotazioni.
--   2. recipient_mode/recipient_phones/recipient_admin_roles → il destinatario
--      di QUALSIASI messaggio si configura dalla UI, senza toccare il codice.

-- Minuto preciso di invio (Roma). send_hour da solo permetteva solo gli scatti
-- in punto: "sabato alle 18:30" era impossibile.
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS send_minute INTEGER DEFAULT 0;

-- Finestra di validita' della ricorrenza (entrambe opzionali: NULL = sempre).
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS recurrence_start_date DATE;
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS recurrence_end_date DATE;

-- Destinatari configurabili.
--   'customer'      → il cliente della pratica (comportamento storico)
--   'custom_phones' → i numeri elencati in recipient_phones (uno o piu')
--   'admin_roles'   → gli operatori con i role tag in recipient_admin_roles
--                     (numero letto da admins.contatto_interno)
--   'all_customers' → tutti i clienti con telefono (broadcast marketing)
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS recipient_mode TEXT DEFAULT 'customer';

-- CSV di numeri (con o senza prefisso: normalizzati a sole cifre in invio).
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS recipient_phones TEXT;

-- CSV di role tag (vedi admin_role_tags / useAdminRole).
ALTER TABLE system_messages ADD COLUMN IF NOT EXISTS recipient_admin_roles TEXT;

COMMENT ON COLUMN system_messages.send_minute IS 'Minuto di invio (0-59, ora di Roma). Usato con send_hour.';
COMMENT ON COLUMN system_messages.recurrence_start_date IS 'Prima data in cui la ricorrenza on_schedule puo'' partire (NULL = nessun limite).';
COMMENT ON COLUMN system_messages.recurrence_end_date IS 'Ultima data in cui la ricorrenza on_schedule puo'' partire (NULL = nessun limite).';
COMMENT ON COLUMN system_messages.recipient_mode IS 'customer | custom_phones | admin_roles | all_customers';
COMMENT ON COLUMN system_messages.recipient_phones IS 'CSV di numeri destinatari quando recipient_mode = custom_phones.';
COMMENT ON COLUMN system_messages.recipient_admin_roles IS 'CSV di role tag destinatari quando recipient_mode = admin_roles.';

-- I template esistenti restano invariati: destinatario = cliente della pratica.
UPDATE system_messages SET recipient_mode = 'customer' WHERE recipient_mode IS NULL;
