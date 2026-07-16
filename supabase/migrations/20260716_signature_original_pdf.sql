-- ============================================
-- Preserva il PDF firmato ORIGINALE (firma autentica) per la riconduzione
-- ============================================
-- La riconduzione estensione sovrascriveva signed_pdf_url col PDF ricondotto,
-- perdendo per sempre il riferimento alla firma AUTENTICA. Aggiungiamo una
-- colonna durevole che conserva l'originale e non viene mai sovrascritta.

ALTER TABLE signature_requests
    ADD COLUMN IF NOT EXISTS original_signed_pdf_url TEXT;

COMMENT ON COLUMN signature_requests.original_signed_pdf_url IS 'URL del PDF firmato ORIGINALE (firma autentica Trustera) — sorgente per la riconduzione; MAI sovrascritto dal ricondotto.';

-- Backfill: le richieste firmate NON ancora ricondotte hanno gia in signed_pdf_url
-- l'originale autentico. Le ricondotte (signed_pdf_url contiene "_ricondotto_")
-- restano NULL → segnalano che l'originale va ripristinato manualmente.
UPDATE signature_requests
SET original_signed_pdf_url = signed_pdf_url
WHERE original_signed_pdf_url IS NULL
  AND status = 'signed'
  AND signed_pdf_url IS NOT NULL
  AND signed_pdf_url NOT LIKE '%\_ricondotto\_%';
