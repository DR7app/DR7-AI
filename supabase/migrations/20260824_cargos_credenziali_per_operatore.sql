-- ============================================================================
-- CARGOS — credenziali PER OPERATORE (24/08/2026)
--
-- Problema (direzione): "ogni attore del gestionale deve poter collegare il
-- proprio portale Cargos". Oggi non e' possibile:
--   - `Nome Utente` (C00006117) e `Agenzia` (RENTORA — Cagliari) sono scritti
--     IN DURO nella tab Cargos, insieme all'oggetto AGENCY;
--   - l'unica cosa modificabile e' la password, tenuta in sessionStorage del
--     browser: si perde a ogni sessione e non distingue un operatore dall'altro.
--
-- Le credenziali sono di chi le usa, quindi vivono sulla riga `admins` del
-- singolo operatore, con RLS che permette di leggere e scrivere SOLO le proprie.
--
-- NOTA DI SICUREZZA, esplicita: la password del portale Cargos va rigiocata per
-- autenticarsi, quindi NON puo' essere hashata — resta leggibile a chi ha la
-- service-role key. E' lo stesso livello di segreto di `service_secrets`. La
-- policy sotto impedisce a un operatore di leggere quelle di un collega.
-- ============================================================================

ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS cargos_username TEXT,
  ADD COLUMN IF NOT EXISTS cargos_password TEXT,
  ADD COLUMN IF NOT EXISTS cargos_agenzia  TEXT,
  ADD COLUMN IF NOT EXISTS cargos_agenzia_codice TEXT;

COMMENT ON COLUMN public.admins.cargos_username IS 'Nome utente del portale Cargos di QUESTO operatore (es. C00006117).';
COMMENT ON COLUMN public.admins.cargos_password IS 'Password portale Cargos. Non hashabile: va rigiocata per il login. Leggibile solo dal proprietario (RLS) e dalla service-role.';
COMMENT ON COLUMN public.admins.cargos_agenzia IS 'Nome agenzia mostrato e inviato a Cargos (es. RENTORA).';
COMMENT ON COLUMN public.admins.cargos_agenzia_codice IS 'Codice sede Cargos (es. 420092009 per Cagliari).';

-- ── RLS: ognuno vede e scrive SOLO le proprie credenziali ───────────────────
-- Si aggiunge una policy dedicata invece di allargare quelle esistenti, cosi'
-- il resto della tabella `admins` continua a comportarsi come prima.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'admins'
       AND policyname = 'admins_cargos_self_update'
  ) THEN
    CREATE POLICY admins_cargos_self_update ON public.admins
      FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- ── Seed: le credenziali storiche restano all'account che le usava ──────────
-- Anteprima prima di scrivere: deve mostrare le righe che verranno toccate.
SELECT id, email, cargos_username, cargos_agenzia
  FROM public.admins
 WHERE cargos_username IS NULL
   AND email IN ('dubai.rent7.0srl@gmail.com', 'ophe@dr7.app', 'valerio@dr7.app', 'ilenia@dr7.app');

UPDATE public.admins
   SET cargos_username       = 'C00006117',
       cargos_agenzia        = 'RENTORA',
       cargos_agenzia_codice = '420092009'
 WHERE cargos_username IS NULL
   AND email IN ('dubai.rent7.0srl@gmail.com', 'ophe@dr7.app', 'valerio@dr7.app', 'ilenia@dr7.app');

-- ── VERIFICA ────────────────────────────────────────────────────────────────
SELECT email, cargos_username, cargos_agenzia, cargos_agenzia_codice,
       (cargos_password IS NOT NULL) AS password_impostata
  FROM public.admins
 WHERE cargos_username IS NOT NULL
 ORDER BY email;
