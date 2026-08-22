-- 2026-08-22: normalizza i blocchi manuali della tab Recensioni.
-- Fino ad oggi "Blocca" salvava send_status='SENT' (= richiesta inviata),
-- quindi dopo un refresh la riga si presentava come "Inviato" e lo sweep
-- automatico poteva sovrascriverla. Lo stato corretto e' 'BLOCKED'.
UPDATE review_candidates
SET send_status = 'BLOCKED',
    updated_at  = NOW()
WHERE exclusion_reason_code = 'ALREADY_REVIEWED'
  AND send_status = 'SENT';
