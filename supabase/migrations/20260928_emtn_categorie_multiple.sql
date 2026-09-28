-- 28/09/2026 (direzione): una segnalazione EMTN puo' avere piu' categorie
-- (es. danno + penale + insoluto) e c'e' la categoria "Penale non saldata".
--
-- `type` resta la categoria principale (la prima scelta): i contatori e le
-- viste esistenti continuano a leggerla. `categorie` contiene TUTTE quelle
-- scelte, principale compresa.
--
-- Idempotente.

ALTER TYPE public.emtn_event_type ADD VALUE IF NOT EXISTS 'UNPAID_PENALTY';

ALTER TABLE public.emtn_events
    ADD COLUMN IF NOT EXISTS categorie text[] NOT NULL DEFAULT '{}';

-- Le segnalazioni gia' presenti hanno una sola categoria: la loro.
UPDATE public.emtn_events
SET categorie = ARRAY[type::text]
WHERE categorie = '{}';
