-- ============================================================
-- Pause obbligatorie: lettura condivisa della sola pause_config
-- ============================================================
-- 2026-08-02 (#32, bug ricorrente "le pause automatiche non compaiono").
--
-- operatore_contratto ha due policy (migration 20260511):
--   - operatore_contratto_direzione_all -> solo valerio@ / ilenia@ / ophe@
--   - operatore_contratto_self_read     -> l'operatore vede SOLO se stesso
--
-- Risultato: qualunque altro admin che apriva Rilevazione Orari / Report
-- Operatori riceveva una lista VUOTA (la RLS filtra, non lancia errore), e le
-- pause fisse configurate dalla direzione sparivano in silenzio. Il client
-- aveva anche un try/catch attorno alla query, quindi nemmeno un warning.
--
-- Qui si espone SOLO (operatore_id, pause_config) tramite una funzione
-- SECURITY DEFINER: nessun dato di compenso esce dalla policy direzione.
-- Chi puo' leggere: qualunque admin autenticato (public.admins) + l'operatore
-- stesso per la propria riga.

-- Difensivo: se la migration 20260717 non fosse mai stata eseguita in questo
-- ambiente, la colonna viene creata qui cosi' la funzione compila comunque.
ALTER TABLE public.operatore_contratto
    ADD COLUMN IF NOT EXISTS pause_config JSONB DEFAULT '{"durata_min":0,"pagata":false,"fasce":[]}'::jsonb;

CREATE OR REPLACE FUNCTION public.operatore_pause_config_attive()
RETURNS TABLE (operatore_id UUID, pause_config JSONB)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT c.operatore_id, COALESCE(c.pause_config, '{}'::jsonb)
    FROM public.operatore_contratto c
    WHERE c.attivo = true
      AND (
        -- Admin (qualsiasi ruolo): vede le pause di tutti gli operatori.
        EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = auth.uid())
        -- Operatore non admin: solo la propria.
        OR c.user_id = auth.uid()
        OR c.operatore_id IN (
            SELECT p.id FROM public.operatori_persone p WHERE p.user_id = auth.uid()
        )
      );
$$;

COMMENT ON FUNCTION public.operatore_pause_config_attive() IS
    'Pause obbligatorie (operatore_contratto.pause_config) dei contratti attivi. SECURITY DEFINER: espone SOLO operatore_id + pause_config, mai stipendio/paga oraria. Serve perche la RLS di operatore_contratto e ristretta alla direzione e nascondeva le pause fisse a tutti gli altri admin.';

REVOKE ALL ON FUNCTION public.operatore_pause_config_attive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operatore_pause_config_attive() TO authenticated;

-- Verifica rapida (da eseguire loggati come admin non-direzione):
--   SELECT * FROM public.operatore_pause_config_attive();
-- Deve tornare una riga per ogni operatore con contratto attivo.
