-- Quiet hours per i template Messaggi di Sistema Pro.
-- Permette all'admin di definire una fascia oraria (Europe/Rome) in cui
-- il sistema NON deve inviare il messaggio (es. 22:00-07:00 di notte).
--
-- Format: 2 colonne integer 0..23. Se entrambi NULL, nessuna fascia
-- silenziosa (default). Se start > end, la fascia attraversa la mezzanotte
-- (es. start=22, end=7 → quiet 22-23:59 + 0-6:59).
--
-- Esempio: quiet_hours_start=22, quiet_hours_end=7 → niente messaggi
-- dalle 22:00 alle 07:00 Rome time. Il messaggio resta in coda fino
-- al primo giro di cron utile fuori dalla fascia (oppure al cron del
-- giorno seguente in base agli altri filtri).

ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS quiet_hours_start INTEGER;
ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS quiet_hours_end INTEGER;

COMMENT ON COLUMN system_messages.quiet_hours_start IS
    'Ora di inizio fascia silenziosa (0-23, Europe/Rome). NULL = nessuna fascia.';
COMMENT ON COLUMN system_messages.quiet_hours_end IS
    'Ora di fine fascia silenziosa esclusiva (0-23, Europe/Rome). Se start>end attraversa la mezzanotte.';
