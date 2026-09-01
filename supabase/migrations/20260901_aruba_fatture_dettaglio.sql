-- Cache dei dettagli delle fatture ricevute da Aruba.
--
-- L'elenco di findByUsername non porta numero, data e importo: verificato il
-- 01/09/2026, 78 righe su 78 arrivavano vuote. Ogni riga va chiesta a
-- getByFilename, che costa ~4,3 secondi. Su un anno (500 fatture) sono ore di
-- attesa ripetute a ogni apertura della scheda.
--
-- Una fattura gia' emessa non cambia piu': numero, data e importo si leggono
-- una volta sola e restano qui. La chiave e' il filename Aruba, che e'
-- l'identita' vera del documento (vedi la migrazione dei doppioni fornitore).
--
-- Nessuna policy: RLS attiva e nessun accesso pubblico. Ci scrivono e leggono
-- solo le Netlify function, che usano la service role key.

CREATE TABLE IF NOT EXISTS aruba_fatture_dettaglio (
    aruba_filename    TEXT PRIMARY KEY,
    numero_documento  TEXT,
    data_documento    DATE,
    importo           NUMERIC(14,2),
    letto_il          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE aruba_fatture_dettaglio ENABLE ROW LEVEL SECURITY;

-- Serve per riempire a blocchi le righe ancora mancanti.
CREATE INDEX IF NOT EXISTS idx_aruba_fatture_dettaglio_letto_il
    ON aruba_fatture_dettaglio (letto_il DESC);

COMMENT ON TABLE aruba_fatture_dettaglio IS
    'Numero/data/importo delle fatture ricevute, letti una volta da Aruba getByFilename. Chiave: aruba_filename.';
