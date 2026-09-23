-- Prevendite: piu' foto per prevendita, sul sito in un carosello (23/09/2026).
-- foto_url resta la copertina (prima foto): la leggono Mie Prevendite, la
-- vendita allo sportello e le righe gia' vendute di prevendite_clienti.
ALTER TABLE public.prevendite
  ADD COLUMN IF NOT EXISTS foto_urls text[] NOT NULL DEFAULT '{}';

-- Le prevendite che avevano gia' una foto la ritrovano come prima del carosello.
UPDATE public.prevendite
SET foto_urls = ARRAY[foto_url]
WHERE foto_url IS NOT NULL AND foto_url <> '' AND cardinality(foto_urls) = 0;

SELECT id, nome, foto_url, foto_urls FROM public.prevendite ORDER BY nome;
