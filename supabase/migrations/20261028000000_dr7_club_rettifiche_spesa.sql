-- ═══════════════════════════════════════════════════════════════════════════
-- DR7 CLUB: RETTIFICA MANUALE DELLA SPESA ANNUA — 28/10/2026
--
-- La spesa annua (che decide il livello del Club e la % di cashback) si
-- calcola da prenotazioni e ricariche. Quando una prenotazione e' registrata
-- con il metodo sbagliato (Runchina: Macan segnata "Carta" ma pagata dal
-- wallet) la cifra sale e il cliente cambia livello senza motivo.
--
-- Una rettifica e' una riga con un importo (negativo = toglie, positivo =
-- aggiunge). Conta per 12 mesi dalla data in cui e' creata, come le
-- prenotazioni che corregge.
--
-- Scrive SOLO il server (funzione dr7-club-rettifica-spesa, con OTP della
-- direzione): nessuna policy di scrittura per authenticated, altrimenti un
-- cliente potrebbe alzarsi il livello da solo. Il cliente legge le proprie
-- righe (il sito calcola la sua barra), lo staff le legge tutte.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dr7_club_rettifiche_spesa (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL,
  importo      NUMERIC(12,2) NOT NULL CHECK (importo <> 0),
  nota         TEXT,
  creato_da    TEXT,
  override_id  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr7_club_rettifiche_user
  ON public.dr7_club_rettifiche_spesa (user_id, created_at);

ALTER TABLE public.dr7_club_rettifiche_spesa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dcrs_proprie ON public.dr7_club_rettifiche_spesa;
CREATE POLICY dcrs_proprie ON public.dr7_club_rettifiche_spesa
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS dcrs_staff ON public.dr7_club_rettifiche_spesa;
CREATE POLICY dcrs_staff ON public.dr7_club_rettifiche_spesa
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid()));

REVOKE ALL ON public.dr7_club_rettifiche_spesa FROM anon, authenticated;
GRANT SELECT ON public.dr7_club_rettifiche_spesa TO authenticated;
GRANT ALL ON public.dr7_club_rettifiche_spesa TO service_role;
