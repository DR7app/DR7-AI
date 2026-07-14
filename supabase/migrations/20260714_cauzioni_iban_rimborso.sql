-- ============================================
-- CAUZIONI: dati per rimborso manuale (bonifico)
-- ============================================
-- Valerio/Ilenia il giorno della scadenza devono avere pronti IBAN e
-- intestatario del conto del cliente a cui effettuare il bonifico di
-- restituzione. Aggiungiamo due campi liberi sulla cauzione.

ALTER TABLE cauzioni
    ADD COLUMN IF NOT EXISTS iban TEXT,
    ADD COLUMN IF NOT EXISTS intestatario_conto TEXT;

COMMENT ON COLUMN cauzioni.iban IS 'IBAN del cliente per il rimborso della cauzione (bonifico manuale)';
COMMENT ON COLUMN cauzioni.intestatario_conto IS 'Intestatario del conto per il rimborso della cauzione (bonifico manuale)';
