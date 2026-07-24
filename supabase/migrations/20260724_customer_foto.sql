-- Foto cliente nella scheda (roadmap 21). URL pubblico dell'immagine caricata.
ALTER TABLE public.customers_extended
  ADD COLUMN IF NOT EXISTS foto_url TEXT;
COMMENT ON COLUMN public.customers_extended.foto_url IS 'URL foto del cliente mostrata nella scheda';
