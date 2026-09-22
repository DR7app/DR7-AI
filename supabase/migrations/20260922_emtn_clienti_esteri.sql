-- 22/09/2026 (direzione): EMTN anche per clienti ESTERI senza codice fiscale.
-- Il cliente estero si riconosce da nome + cognome + data di nascita, con
-- nazionalita' e documento (carta d'identita' o passaporto).
--
-- Da eseguire UNA volta nel SQL Editor di Supabase. Idempotente.

-- 1. Il codice fiscale diventa facoltativo. Il controllo di formato esistente
--    (emtn_clients_cf_format) resta: su un valore NULL non scatta.
ALTER TABLE public.emtn_clients ALTER COLUMN codice_fiscale DROP NOT NULL;

-- 2. Dati del cliente estero.
ALTER TABLE public.emtn_clients ADD COLUMN IF NOT EXISTS nazionalita text;
ALTER TABLE public.emtn_clients ADD COLUMN IF NOT EXISTS documento_tipo text;
ALTER TABLE public.emtn_clients ADD COLUMN IF NOT EXISTS documento_numero text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emtn_documento_tipo') THEN
    ALTER TABLE public.emtn_clients
      ADD CONSTRAINT emtn_documento_tipo
      CHECK (documento_tipo IS NULL OR documento_tipo IN ('carta_identita', 'passaporto'));
  END IF;
  -- Senza codice fiscale servono almeno nome, cognome e data di nascita.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'emtn_identita_minima') THEN
    ALTER TABLE public.emtn_clients
      ADD CONSTRAINT emtn_identita_minima
      CHECK (codice_fiscale IS NOT NULL OR (nome IS NOT NULL AND cognome IS NOT NULL AND data_nascita IS NOT NULL));
  END IF;
END $$;

-- 3. Lo stesso documento non puo' appartenere a due clienti.
CREATE UNIQUE INDEX IF NOT EXISTS ux_emtn_clients_documento
  ON public.emtn_clients (documento_tipo, upper(coalesce(nazionalita, '')), upper(documento_numero))
  WHERE documento_numero IS NOT NULL;

-- 4. Ricerca veloce dei clienti esteri per nome + data di nascita.
CREATE INDEX IF NOT EXISTS idx_emtn_clients_estero
  ON public.emtn_clients (lower(cognome), lower(nome), data_nascita)
  WHERE codice_fiscale IS NULL;

-- Verifica: deve restituire 3 righe.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'emtn_clients'
  AND column_name IN ('nazionalita', 'documento_tipo', 'documento_numero');
