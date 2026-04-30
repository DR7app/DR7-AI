-- ─────────────────────────────────────────────────────────────────────────
-- FORNITORI MODULE — Amministrazione → Fornitori
-- Anagrafica, registro mensile documenti, controllo incrociato bolle/fatture,
-- workflow approvazione pagamenti, scadenziario, alert intelligenti.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Anagrafica fornitore
CREATE TABLE IF NOT EXISTS public.fornitori (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome TEXT NOT NULL,
    piva TEXT,
    referente TEXT,
    telefono TEXT,
    email TEXT,
    iban TEXT,
    categoria_merce TEXT,
    condizioni_pagamento TEXT,
    scadenza_default_giorni INTEGER NOT NULL DEFAULT 30,
    indirizzo TEXT,
    citta TEXT,
    cap TEXT,
    provincia TEXT,
    note TEXT,
    attivo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID
);

-- Drop column if it was created by an earlier run of this migration
ALTER TABLE public.fornitori DROP COLUMN IF EXISTS codice_fiscale;

CREATE INDEX IF NOT EXISTS idx_fornitori_nome ON public.fornitori(LOWER(nome));
CREATE INDEX IF NOT EXISTS idx_fornitori_piva ON public.fornitori(piva) WHERE piva IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fornitori_attivo ON public.fornitori(attivo) WHERE attivo = TRUE;

-- 2. Documenti fornitore (DDT, bolle, fatture, note credito, ricevute)
CREATE TABLE IF NOT EXISTS public.fornitore_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fornitore_id UUID NOT NULL REFERENCES public.fornitori(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('ddt', 'bolla', 'fattura', 'nota_credito', 'ricevuta_pagamento')),
    numero_documento TEXT NOT NULL,
    data_documento DATE NOT NULL,
    data_scadenza DATE,
    -- Computed period for monthly grouping (Europe/Rome timezone)
    periodo_anno INTEGER GENERATED ALWAYS AS (EXTRACT(YEAR FROM data_documento)::INTEGER) STORED,
    periodo_mese INTEGER GENERATED ALWAYS AS (EXTRACT(MONTH FROM data_documento)::INTEGER) STORED,
    importo_imponibile NUMERIC(12, 2),
    importo_iva NUMERIC(12, 2),
    importo_totale NUMERIC(12, 2) NOT NULL,
    -- Optional link DDT/bolla → fattura when admin manually associates them
    fattura_collegata_id UUID REFERENCES public.fornitore_documents(id) ON DELETE SET NULL,
    file_url TEXT,
    file_name TEXT,
    file_hash TEXT, -- sha256, used for duplicate detection
    -- Workflow state
    stato TEXT NOT NULL DEFAULT 'caricato' CHECK (stato IN (
        'caricato',
        'verificato',
        'anomalia',
        'in_verifica',
        'approvato',
        'pagabile',
        'bloccato',
        'pagato',
        'archiviato'
    )),
    metodo_pagamento TEXT,
    data_pagamento DATE,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_fornitore_docs_fornitore ON public.fornitore_documents(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_fornitore_docs_periodo ON public.fornitore_documents(fornitore_id, periodo_anno, periodo_mese);
CREATE INDEX IF NOT EXISTS idx_fornitore_docs_tipo ON public.fornitore_documents(fornitore_id, tipo);
CREATE INDEX IF NOT EXISTS idx_fornitore_docs_scadenza ON public.fornitore_documents(data_scadenza)
    WHERE data_scadenza IS NOT NULL AND stato NOT IN ('pagato', 'archiviato', 'bloccato');
CREATE INDEX IF NOT EXISTS idx_fornitore_docs_stato ON public.fornitore_documents(stato);
CREATE INDEX IF NOT EXISTS idx_fornitore_docs_hash ON public.fornitore_documents(fornitore_id, file_hash)
    WHERE file_hash IS NOT NULL;

-- Duplicate detection unique: stesso fornitore + stesso tipo + stesso numero + stessa data
CREATE UNIQUE INDEX IF NOT EXISTS uniq_fornitore_doc_natural
    ON public.fornitore_documents(fornitore_id, tipo, numero_documento, data_documento);

-- 3. Alert table
CREATE TABLE IF NOT EXISTS public.fornitore_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fornitore_id UUID NOT NULL REFERENCES public.fornitori(id) ON DELETE CASCADE,
    document_id UUID REFERENCES public.fornitore_documents(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('scadenza_imminente', 'scadenza_oggi', 'scaduta', 'anomalia_importi', 'bolle_mancanti', 'duplicato')),
    severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'error')),
    messaggio TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID,
    resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fornitore_alerts_fornitore ON public.fornitore_alerts(fornitore_id);
CREATE INDEX IF NOT EXISTS idx_fornitore_alerts_open ON public.fornitore_alerts(status, severity) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_fornitore_alerts_doc ON public.fornitore_alerts(document_id) WHERE document_id IS NOT NULL;

-- 4. Updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fornitori_updated_at ON public.fornitori;
CREATE TRIGGER trg_fornitori_updated_at
    BEFORE UPDATE ON public.fornitori
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS trg_fornitore_documents_updated_at ON public.fornitore_documents;
CREATE TRIGGER trg_fornitore_documents_updated_at
    BEFORE UPDATE ON public.fornitore_documents
    FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. Cross-check function — recompute fattura status from DDT total in same period
CREATE OR REPLACE FUNCTION public.fornitore_fatture_crosscheck(p_fornitore_id UUID, p_anno INTEGER, p_mese INTEGER)
RETURNS TABLE (
    fattura_id UUID,
    fattura_numero TEXT,
    fattura_data DATE,
    fattura_totale NUMERIC,
    ddt_totale NUMERIC,
    differenza NUMERIC,
    stato_calcolato TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        f.id,
        f.numero_documento,
        f.data_documento,
        f.importo_totale,
        COALESCE(SUM(d.importo_totale), 0)::NUMERIC AS ddt_totale,
        (f.importo_totale - COALESCE(SUM(d.importo_totale), 0))::NUMERIC AS differenza,
        CASE
            WHEN COALESCE(SUM(d.importo_totale), 0) = 0 THEN 'anomalia'
            WHEN ABS(f.importo_totale - COALESCE(SUM(d.importo_totale), 0)) < 0.01 THEN 'verificato'
            ELSE 'anomalia'
        END AS stato_calcolato
    FROM public.fornitore_documents f
    LEFT JOIN public.fornitore_documents d
        ON d.fornitore_id = f.fornitore_id
        AND d.tipo IN ('ddt', 'bolla')
        AND d.periodo_anno = f.periodo_anno
        AND d.periodo_mese = f.periodo_mese
        AND (d.fattura_collegata_id IS NULL OR d.fattura_collegata_id = f.id)
    WHERE f.fornitore_id = p_fornitore_id
        AND f.tipo = 'fattura'
        AND f.periodo_anno = p_anno
        AND f.periodo_mese = p_mese
    GROUP BY f.id, f.numero_documento, f.data_documento, f.importo_totale;
END;
$$ LANGUAGE plpgsql STABLE;

-- 6. Storage bucket for documents
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'fornitori-documents',
    'fornitori-documents',
    false, -- private; signed URLs only
    20971520, -- 20 MB
    ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 7. Storage RLS — authenticated only
DROP POLICY IF EXISTS "fornitori-documents authenticated select" ON storage.objects;
CREATE POLICY "fornitori-documents authenticated select"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'fornitori-documents');

DROP POLICY IF EXISTS "fornitori-documents authenticated insert" ON storage.objects;
CREATE POLICY "fornitori-documents authenticated insert"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'fornitori-documents');

DROP POLICY IF EXISTS "fornitori-documents authenticated update" ON storage.objects;
CREATE POLICY "fornitori-documents authenticated update"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'fornitori-documents')
    WITH CHECK (bucket_id = 'fornitori-documents');

DROP POLICY IF EXISTS "fornitori-documents authenticated delete" ON storage.objects;
CREATE POLICY "fornitori-documents authenticated delete"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'fornitori-documents');

-- 8. Table RLS — authenticated read/write (admin app uses service role anyway)
ALTER TABLE public.fornitori ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornitore_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fornitore_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fornitori auth full" ON public.fornitori;
CREATE POLICY "fornitori auth full" ON public.fornitori
    TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "fornitore_documents auth full" ON public.fornitore_documents;
CREATE POLICY "fornitore_documents auth full" ON public.fornitore_documents
    TO authenticated USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS "fornitore_alerts auth full" ON public.fornitore_alerts;
CREATE POLICY "fornitore_alerts auth full" ON public.fornitore_alerts
    TO authenticated USING (TRUE) WITH CHECK (TRUE);
