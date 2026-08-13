-- Patente nautica sulla scheda cliente.
--
-- Serve al Noleggio Mare: senza questi campi non c'e' modo di sapere se il
-- cliente puo' condurre l'unita' che sta prenotando. Il limite (entro 12
-- miglia / senza limiti) e l'abilitazione (solo motore / vela e motore)
-- sono i due dati che decidono quale barca puo' prendere: per questo sono
-- colonne separate e non un unico campo di testo.
--
-- I nomi ricalcano quelli della patente di guida gia' presenti
-- (numero_patente, tipo_patente, emessa_da, data_rilascio_patente,
-- scadenza_patente) con il suffisso _nautica.

ALTER TABLE public.customers_extended
    ADD COLUMN IF NOT EXISTS numero_patente_nautica        TEXT,
    -- Categoria ministeriale: A (unita' da diporto), B (navi da diporto
    -- oltre 24 m), C (direzione nautica per disabili).
    ADD COLUMN IF NOT EXISTS categoria_patente_nautica     TEXT,
    -- 'entro 12 miglia' oppure 'senza limiti'.
    ADD COLUMN IF NOT EXISTS limite_patente_nautica        TEXT,
    -- 'Motore' oppure 'Vela e motore'.
    ADD COLUMN IF NOT EXISTS abilitazione_patente_nautica  TEXT,
    -- Motorizzazione Civile o Capitaneria di Porto che l'ha rilasciata.
    ADD COLUMN IF NOT EXISTS emessa_da_nautica             TEXT,
    ADD COLUMN IF NOT EXISTS data_rilascio_patente_nautica DATE,
    ADD COLUMN IF NOT EXISTS scadenza_patente_nautica      DATE;

COMMENT ON COLUMN public.customers_extended.numero_patente_nautica IS 'Numero della patente nautica';
COMMENT ON COLUMN public.customers_extended.categoria_patente_nautica IS 'Categoria: A, B o C';
COMMENT ON COLUMN public.customers_extended.limite_patente_nautica IS 'entro 12 miglia | senza limiti';
COMMENT ON COLUMN public.customers_extended.abilitazione_patente_nautica IS 'Motore | Vela e motore';
COMMENT ON COLUMN public.customers_extended.emessa_da_nautica IS 'Motorizzazione Civile / Capitaneria di Porto di rilascio';

-- Indice per la ricerca delle patenti nautiche in scadenza (pannello
-- documenti in scadenza). Parziale: le righe senza patente nautica sono
-- la maggioranza e non devono pesare sull'indice.
CREATE INDEX IF NOT EXISTS idx_customers_extended_scadenza_nautica
    ON public.customers_extended (scadenza_patente_nautica)
    WHERE scadenza_patente_nautica IS NOT NULL;
