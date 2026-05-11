-- Fix RLS per operatore_contratto.
--
-- Le policy create da 20260511_operatore_contratto.sql facevano
--   SELECT 1 FROM auth.users WHERE id = auth.uid()
-- ma il ruolo `authenticated` NON ha permesso SELECT su auth.users
-- (per design Supabase), quindi qualsiasi query sul tab Contratti
-- ritornava "permission denied for table users".
--
-- Soluzione: usare l'email gia' presente nel JWT via auth.jwt(), che
-- non richiede di leggere auth.users.

-- Direzione + ophe: accesso pieno (CRUD)
DROP POLICY IF EXISTS operatore_contratto_direzione_all ON public.operatore_contratto;
CREATE POLICY operatore_contratto_direzione_all ON public.operatore_contratto
  FOR ALL
  USING (
    LOWER(COALESCE(auth.jwt() ->> 'email', '')) IN (
      'valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app'
    )
  )
  WITH CHECK (
    LOWER(COALESCE(auth.jwt() ->> 'email', '')) IN (
      'valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app'
    )
  );

-- Operatore stesso: read-only sul proprio contratto. La policy
-- precedente faceva SELECT sui propri record via user_id o tramite
-- join su operatori_persone — ricreiamola identica (operatori_persone
-- ha la sua RLS quindi il sub-query e' ok per il role authenticated).
DROP POLICY IF EXISTS operatore_contratto_self_read ON public.operatore_contratto;
CREATE POLICY operatore_contratto_self_read ON public.operatore_contratto
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR operatore_id IN (
      SELECT id FROM public.operatori_persone WHERE user_id = auth.uid()
    )
  );
