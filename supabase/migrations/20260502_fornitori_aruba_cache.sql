-- Cache Aruba invoice counts on the fornitori row itself so the list view
-- can render instantly without hitting Aruba on every load. Updated by the
-- backend whenever a sync runs.
ALTER TABLE public.fornitori
    ADD COLUMN IF NOT EXISTS aruba_invoices_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aruba_invoices_total_eur NUMERIC(12, 2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS aruba_last_invoice_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS aruba_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_fornitori_aruba_synced_at
    ON public.fornitori(aruba_synced_at);
