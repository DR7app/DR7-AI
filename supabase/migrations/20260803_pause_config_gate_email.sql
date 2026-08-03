-- ============================================================
-- Pause obbligatorie: gate della RPC anche via EMAIL + reload PostgREST
-- ============================================================
-- 2026-08-03 (#32, seguito): la RPC operatore_pause_config_attive() del
-- 20260802 autorizzava SOLO chi ha admins.user_id = auth.uid(). Ma in questo
-- progetto admins/operatori vengono spesso abbinati per EMAIL (useAdminRole
-- ha un fallback esplicito "user_id non ancora settato", AccontiTab/TicketTab
-- leggono .eq('email', ...)). Per gli account con admins.user_id NULL il gate
-- tornava FALSE -> la RPC restituiva lista vuota -> le pause fisse sparivano
-- di nuovo (esattamente il sintomo: le pause del contratto non si applicano,
-- solo quelle timbrate a mano compaiono).
--
-- Qui si abbina l'utente anche per email (admins.email e operatori_persone.email)
-- oltre che per user_id. Inoltre si forza il reload dello schema PostgREST:
-- una funzione creata dal SQL editor non e' esposta via REST finche' la cache
-- non si ricarica, quindi supabase.rpc(...) dava 404 e il client cadeva in
-- silenzio sulla lettura diretta (bloccata dalla RLS) -> di nuovo vuoto.

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
        -- Admin (qualsiasi ruolo): abbinato per user_id OPPURE per email.
        EXISTS (
            SELECT 1 FROM public.admins a
            WHERE a.user_id = auth.uid()
               OR lower(a.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
        -- Operatore non admin: solo la propria riga (user_id o email).
        OR c.user_id = auth.uid()
        OR c.operatore_id IN (
            SELECT p.id FROM public.operatori_persone p
            WHERE p.user_id = auth.uid()
               OR lower(p.email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
        )
      );
$$;

REVOKE ALL ON FUNCTION public.operatore_pause_config_attive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.operatore_pause_config_attive() TO authenticated;

-- Espone subito la funzione via REST (evita il 404 -> fallback silenzioso).
NOTIFY pgrst, 'reload schema';

-- Verifica (loggata come admin qualsiasi, DAL BROWSER/app, non dal SQL editor
-- dove auth.uid() e auth.jwt() sono nulli):
--   la RPC deve tornare una riga per ogni operatore con contratto attivo.
