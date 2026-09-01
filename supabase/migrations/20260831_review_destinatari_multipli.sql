-- ============================================================
-- Recensioni: una richiesta per OGNI persona della prenotazione
-- Migration: 20260831_review_destinatari_multipli
--
-- Prima: review_candidates aveva UNIQUE (source_record_id, service_type),
-- quindi una prenotazione = un solo candidato = solo l'intestatario riceveva
-- la richiesta di recensione. Il 2° guidatore, il garante del veicolo e i
-- fideiussori — che hanno vissuto lo stesso servizio e firmato il contratto —
-- non ricevevano nulla.
--
-- Dopo: una riga per (prenotazione, servizio, RUOLO). recipient_role default
-- 'CLIENTE' cosi' tutte le righe esistenti restano valide senza backfill.
-- ============================================================

ALTER TABLE review_candidates
  ADD COLUMN IF NOT EXISTS recipient_role TEXT NOT NULL DEFAULT 'CLIENTE';

-- Storico: qualsiasi riga creata prima di questa migrazione e' l'intestatario.
UPDATE review_candidates
   SET recipient_role = 'CLIENTE'
 WHERE recipient_role IS NULL OR recipient_role = '';

ALTER TABLE review_candidates
  DROP CONSTRAINT IF EXISTS review_candidates_source_record_id_service_type_key;

-- Anche l'eventuale indice unico creato a mano su un ambiente clonato.
DROP INDEX IF EXISTS review_candidates_source_record_id_service_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_candidates_source_service_role
  ON review_candidates (source_record_id, service_type, recipient_role);

CREATE INDEX IF NOT EXISTS idx_review_candidates_recipient_role
  ON review_candidates (recipient_role);

COMMENT ON COLUMN review_candidates.recipient_role IS
  'Persona della prenotazione destinataria della richiesta: CLIENTE, SECONDO_GUIDATORE, GARANTE, FIDEIUSSORE_1..3. Stessi ruoli dei firmatari del contratto.';
