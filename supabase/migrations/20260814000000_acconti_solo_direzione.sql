-- ============================================================================
-- Acconti: solo la DIREZIONE vede gli acconti di tutti (2026-08-14)
--
-- Richiesta direzione: gli acconti che un operatore ha incassato sono un dato
-- suo. Solo Valerio e Ilenia vedono la cassa di tutti; ogni altro operatore
-- vede ESCLUSIVAMENTE i propri — David vede i suoi, non quelli di Ophelie.
--
-- Cosa non andava: la UI e' gia' stata stretta a `hasRole('direzione')`, ma la
-- RLS di 20260809020000 usa `dr7_is_direzione()`, che include anche
-- role:developer, role = 'superadmin' e ophe@dr7.app nel failsafe. Risultato:
-- l'interfaccia nascondeva gli acconti altrui, ma la riga restava leggibile via
-- API a chiunque avesse un ruolo tecnico. Il cloisonnement non era reale.
--
-- Qui si introduce un predicato DEDICATO agli acconti, allineato 1:1 con
-- `hasRole('direzione')` lato client: failsafe valerio/ilenia + tag
-- role:direzione in `admins.permissions`. Niente developer, niente superadmin.
--
-- `dr7_is_direzione()` NON viene toccata: la usano anche report_overrides e
-- dr7_can_reports(), e li' il developer deve continuare a vedere tutto.
--
-- Le Netlify Functions usano la service role e bypassano RLS: nessun impatto
-- sui flussi server.
-- ============================================================================

-- Chi puo' vedere/gestire gli acconti di TUTTI gli operatori.
-- SECURITY DEFINER: deve poter leggere `admins` anche quando la RLS di quella
-- tabella non lo permetterebbe al chiamante.
CREATE OR REPLACE FUNCTION public.dr7_can_see_all_acconti()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Failsafe: la direzione non puo' mai restare chiusa fuori dalla propria
    -- cassa se `admins.permissions` viene svuotato o corrotto. Stesso elenco
    -- di ROLE_FAILSAFE in useAdminRole.ts, ma SENZA ophe@dr7.app: il
    -- developer non ha motivo di leggere gli incassi personali altrui.
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.permissions @> '["role:direzione"]'::jsonb
    );
$$;

COMMENT ON FUNCTION public.dr7_can_see_all_acconti() IS
  'Solo direzione (Valerio/Ilenia o tag role:direzione) vede gli acconti di tutti gli operatori. Volutamente piu stretto di dr7_is_direzione(): esclude developer e superadmin.';

-- ── acconti_giornalieri: policy riscritte sul nuovo predicato ────────────────
ALTER TABLE public.acconti_giornalieri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acconti_all    ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_select ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_insert ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_update ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_delete ON public.acconti_giornalieri;

-- L'operatore vede solo i propri, per id o — se non ha ancora un admins.id
-- collegato — per nome (AccontiTab ripiega sul nome denormalizzato).
CREATE POLICY acconti_select ON public.acconti_giornalieri
  FOR SELECT TO authenticated
  USING (
    public.dr7_can_see_all_acconti()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  );

-- La direzione puo' intestare l'acconto a un ALTRO operatore (tendina
-- "Operatore" in AccontiTab); tutti gli altri solo a se stessi.
CREATE POLICY acconti_insert ON public.acconti_giornalieri
  FOR INSERT TO authenticated
  WITH CHECK (
    public.dr7_admin_id() IS NOT NULL
    AND (
      public.dr7_can_see_all_acconti()
      OR operatore_id = public.dr7_admin_id()
      OR (operatore_id IS NULL AND operatore_nome = public.dr7_admin_nome())
    )
  );

CREATE POLICY acconti_update ON public.acconti_giornalieri
  FOR UPDATE TO authenticated
  USING (
    public.dr7_can_see_all_acconti()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  )
  WITH CHECK (
    public.dr7_can_see_all_acconti()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome = public.dr7_admin_nome())
  );

CREATE POLICY acconti_delete ON public.acconti_giornalieri
  FOR DELETE TO authenticated
  USING (
    public.dr7_can_see_all_acconti()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  );

-- Verifica: 4 policy su acconti_giornalieri.
SELECT policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename = 'acconti_giornalieri'
 ORDER BY policyname;
