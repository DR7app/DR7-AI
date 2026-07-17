-- ============================================
-- Pause obbligatorie per operatore (impostate dalla direzione)
-- ============================================
-- Config pause sul contratto operatore: durata giornaliera (minuti) + fasce
-- orarie fisse opzionali + flag pagata/non pagata. Applicata al calcolo ore
-- (Rilevazione Orari / payroll).

ALTER TABLE operatore_contratto
    ADD COLUMN IF NOT EXISTS pause_config JSONB DEFAULT '{"durata_min":0,"pagata":false,"fasce":[]}'::jsonb;

COMMENT ON COLUMN operatore_contratto.pause_config IS 'Pause obbligatorie: {durata_min:int, pagata:bool, fasce:[{da:"HH:MM",a:"HH:MM"}]}';
