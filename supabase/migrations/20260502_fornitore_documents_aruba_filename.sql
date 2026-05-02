-- Track the Aruba SDI filename of an invoice so the UI can re-download
-- the PDF/XML from Aruba on demand without re-uploading it locally.
ALTER TABLE public.fornitore_documents
    ADD COLUMN IF NOT EXISTS aruba_filename TEXT;

CREATE INDEX IF NOT EXISTS idx_fornitore_documents_aruba_filename
    ON public.fornitore_documents(aruba_filename)
    WHERE aruba_filename IS NOT NULL;
