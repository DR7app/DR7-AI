-- Track WHY a preventivo was rejected (so the report can break it down).
-- Values typically: 'cauzione', 'prezzo', 'altro' — but kept as free text
-- for forward compatibility.
ALTER TABLE public.preventivi
    ADD COLUMN IF NOT EXISTS motivo_rifiuto TEXT,
    ADD COLUMN IF NOT EXISTS motivo_rifiuto_note TEXT;

CREATE INDEX IF NOT EXISTS idx_preventivi_motivo_rifiuto
    ON public.preventivi(motivo_rifiuto)
    WHERE motivo_rifiuto IS NOT NULL;
