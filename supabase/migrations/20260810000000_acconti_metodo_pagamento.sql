-- Roadmap #42 — metodo di pagamento sull'acconto giornaliero.
--
-- Gli acconti registravano solo importo, causale e nota: non si sapeva se
-- fossero entrati in CONTANTI, con POS o con bonifico. Senza questo dato la
-- quadratura di cassa a fine giornata e' impossibile: la direzione vede un
-- totale ma non sa quanta parte deve trovarsi fisicamente in cassa.
ALTER TABLE public.acconti_giornalieri
  ADD COLUMN IF NOT EXISTS metodo_pagamento TEXT;

COMMENT ON COLUMN public.acconti_giornalieri.metodo_pagamento IS
  'Come e'' stato incassato l''acconto (Contanti / POS / Bonifico / ...). Etichetta libera, allineata ai metodi configurati in Centralina Pro > Fiscale.';

CREATE INDEX IF NOT EXISTS idx_acconti_metodo ON public.acconti_giornalieri(metodo_pagamento);
