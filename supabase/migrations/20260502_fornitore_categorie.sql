-- Categories for fornitori — user-managed list (was previously hardcoded in UI)
CREATE TABLE IF NOT EXISTS public.fornitore_categorie (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 100,
    attiva BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fornitore_categorie_attiva ON public.fornitore_categorie(attiva, sort_order);

-- Seed with the previously hardcoded list (idempotent)
INSERT INTO public.fornitore_categorie (slug, label, sort_order) VALUES
    ('carburante', 'Carburante', 10),
    ('ricambi', 'Ricambi', 20),
    ('manutenzione', 'Manutenzione', 30),
    ('pneumatici', 'Pneumatici', 40),
    ('lavaggio_prodotti', 'Prodotti lavaggio', 50),
    ('pulizia', 'Pulizia', 60),
    ('ufficio', 'Ufficio', 70),
    ('utenze', 'Utenze', 80),
    ('consulenze', 'Consulenze', 90),
    ('noleggio_attrezzature', 'Noleggio attrezzature', 100),
    ('altro', 'Altro', 999)
ON CONFLICT (slug) DO NOTHING;

DROP TRIGGER IF EXISTS trg_fornitore_categorie_updated_at ON public.fornitore_categorie;
CREATE TRIGGER trg_fornitore_categorie_updated_at
    BEFORE UPDATE ON public.fornitore_categorie
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.fornitore_categorie ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fornitore_categorie auth full" ON public.fornitore_categorie;
CREATE POLICY "fornitore_categorie auth full" ON public.fornitore_categorie
    TO authenticated USING (TRUE) WITH CHECK (TRUE);
