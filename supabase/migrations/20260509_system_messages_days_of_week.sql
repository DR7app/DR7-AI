-- Filtro giorni della settimana per i template di Messaggi di Sistema Pro.
-- Permette all'admin di escludere certi giorni (es. domenica chiuso, niente
-- messaggi quel giorno). Default: tutti i 7 giorni abilitati.
--
-- Format: CSV di numeri JS day-of-week in fuso Europe/Rome:
--   0 = Domenica
--   1 = Lunedi
--   2 = Martedi
--   3 = Mercoledi
--   4 = Giovedi
--   5 = Venerdi
--   6 = Sabato
--
-- Esempio: '1,2,3,4,5,6' = lunedi-sabato (esclude domenica).

ALTER TABLE system_messages
    ADD COLUMN IF NOT EXISTS target_days_of_week TEXT DEFAULT '0,1,2,3,4,5,6';

COMMENT ON COLUMN system_messages.target_days_of_week IS
    'CSV di JS day-of-week (0=Dom, 1=Lun, ..., 6=Sab) Europe/Rome — default tutti i giorni abilitati';
