-- ============================================================================
-- CATALOGO NOLEGGIO: PIU' FOTO E VIDEO PER OGNI ALLOGGIO / MEZZO (10/09/2026)
--
-- Una casa non si racconta con una foto sola: servono le stanze, la vista,
-- la piscina, e il video della visita. Il catalogo (Soggiorni, Mare, Aria)
-- aveva una sola `image_url`.
--
-- `media` e' l'elenco ordinato di tutto quello che si vede:
--   [{"url": "https://...", "tipo": "image"}, {"url": "...", "tipo": "video"}]
-- Il PRIMO elemento immagine resta anche in `image_url`: il sito e ogni
-- scheda che legge la copertina continuano a funzionare senza modifiche.
--
-- Il bucket `catalog-images` accettava solo immagini fino a 10 MB: si allarga
-- ai video (mp4, webm, mov) e a 200 MB, come il bucket del sito.
-- ============================================================================

ALTER TABLE public.noleggio_catalog
  ADD COLUMN IF NOT EXISTS media JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.noleggio_catalog.media IS
  'Galleria ordinata: [{"url","tipo"}] con tipo image|video. La prima immagine e'' anche image_url (copertina).';

-- Le schede che hanno gia' una foto entrano nella galleria con quella foto:
-- nessuno deve ricaricare quello che ha gia' caricato.
UPDATE public.noleggio_catalog
   SET media = jsonb_build_array(jsonb_build_object('url', image_url, 'tipo', 'image'))
 WHERE image_url IS NOT NULL
   AND image_url <> ''
   AND (media IS NULL OR media = '[]'::jsonb);

-- Il bucket delle foto catalogo accoglie anche i video.
UPDATE storage.buckets
   SET file_size_limit = 209715200,  -- 200 MB
       allowed_mime_types = ARRAY[
         'image/png','image/jpeg','image/jpg','image/webp','image/avif','image/gif',
         'video/mp4','video/webm','video/quicktime'
       ]
 WHERE id = 'catalog-images';

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT service_type,
       COUNT(*)                                   AS schede,
       COUNT(*) FILTER (WHERE media <> '[]')      AS con_galleria
  FROM public.noleggio_catalog
 GROUP BY service_type
 ORDER BY service_type;

SELECT id, file_size_limit, allowed_mime_types
  FROM storage.buckets
 WHERE id = 'catalog-images';
