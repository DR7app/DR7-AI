-- ============================================================================
-- RLS su acconti_giornalieri e report_overrides (2026-08-09)
--
-- Entrambe le tabelle nascevano con `FOR ALL TO authenticated USING (true)`:
-- il cloisonnement era SOLO lato browser (AccontiTab filtra per operatore,
-- ReportsTab mostra il toggle di modifica). Via API chiunque fosse
-- autenticato poteva leggere, modificare e cancellare tutto.
--
-- "Autenticato" qui e' molto largo: il gestionale e il SITO condividono lo
-- stesso progetto Supabase, quindi ogni cliente registrato su dr7.app aveva
-- gia' un token valido per queste due tabelle.
--
-- Le policy qui sotto ricalcano ESATTAMENTE il comportamento che l'interfaccia
-- gia' mostra, quindi nessun operatore perde qualcosa:
--   acconti_giornalieri  -> la direzione vede TUTTI gli acconti di TUTTI gli
--                           operatori; ogni altro operatore vede e gestisce
--                           solo i propri (AccontiTab.tsx:47-66)
--   report_overrides     -> chi ha accesso a una tab Report puo' leggere e
--                           scrivere gli override, come oggi
--                           (useAdminRole.hasPermission)
--
-- Le Netlify Functions usano la service role e bypassano RLS: nessun impatto
-- sui flussi server.
-- ============================================================================

-- ── Helper ──────────────────────────────────────────────────────────────────
-- SECURITY DEFINER perche' devono poter leggere `admins` anche quando la RLS
-- di quella tabella non lo permetterebbe al chiamante.

-- Direzione = superadmin, oppure tag role:direzione / role:developer.
-- Gli indirizzi in coda sono il ROLE_FAILSAFE gia' presente nel codice
-- (useAdminRole.ts): garantiscono che la direzione non possa mai restare
-- chiusa fuori se `admins.permissions` viene svuotato o corrotto.
CREATE OR REPLACE FUNCTION public.dr7_is_direzione()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND ( a.role = 'superadmin'
               OR a.permissions @> '["role:direzione"]'::jsonb
               OR a.permissions @> '["role:developer"]'::jsonb )
    );
$$;

-- admins.id dell'utente collegato (NULL se non e' un operatore del gestionale:
-- e' cosi' che i clienti del sito restano fuori).
CREATE OR REPLACE FUNCTION public.dr7_admin_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id FROM public.admins a WHERE a.user_id = auth.uid() LIMIT 1;
$$;

-- Nome operatore: serve perche' AccontiTab ripiega su `operatore_nome` quando
-- l'operatore non ha ancora un admins.id collegato. Senza questo ripiego la
-- policy taglierebbe fuori proprio quel caso.
CREATE OR REPLACE FUNCTION public.dr7_admin_nome()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.nome FROM public.admins a WHERE a.user_id = auth.uid() LIMIT 1;
$$;

-- Accesso ai Report: direzione, permesso jolly, o una qualsiasi tab Report.
-- Stesso elenco di chiavi usato da AdminDashboard.
CREATE OR REPLACE FUNCTION public.dr7_can_reports()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.dr7_is_direzione()
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.permissions ?| array[
               '*', 'reports',
               'report-noleggio', 'report-lavaggio', 'report-clienti',
               'report-autisti', 'report-penali-danni', 'report-preventivi',
               'report-traffic', 'report-gmb'
             ]
    );
$$;

-- ── acconti_giornalieri ─────────────────────────────────────────────────────
ALTER TABLE public.acconti_giornalieri ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS acconti_all           ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_select        ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_insert        ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_update        ON public.acconti_giornalieri;
DROP POLICY IF EXISTS acconti_delete        ON public.acconti_giornalieri;

-- La direzione vede TUTTO (riepilogo giornaliero per operatore).
-- L'operatore vede solo i propri, per id o — se non ha ancora un admins.id
-- collegato — per nome.
CREATE POLICY acconti_select ON public.acconti_giornalieri
  FOR SELECT TO authenticated
  USING (
    public.dr7_is_direzione()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  );

CREATE POLICY acconti_insert ON public.acconti_giornalieri
  FOR INSERT TO authenticated
  WITH CHECK (
    public.dr7_admin_id() IS NOT NULL
    AND (
      public.dr7_is_direzione()
      OR operatore_id = public.dr7_admin_id()
      OR (operatore_id IS NULL AND operatore_nome = public.dr7_admin_nome())
    )
  );

CREATE POLICY acconti_update ON public.acconti_giornalieri
  FOR UPDATE TO authenticated
  USING (
    public.dr7_is_direzione()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  )
  WITH CHECK (
    public.dr7_is_direzione()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome = public.dr7_admin_nome())
  );

CREATE POLICY acconti_delete ON public.acconti_giornalieri
  FOR DELETE TO authenticated
  USING (
    public.dr7_is_direzione()
    OR operatore_id = public.dr7_admin_id()
    OR (operatore_id IS NULL AND operatore_nome IS NOT NULL
        AND operatore_nome = public.dr7_admin_nome())
  );

-- ── report_overrides ────────────────────────────────────────────────────────
ALTER TABLE public.report_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS report_overrides_all    ON public.report_overrides;
DROP POLICY IF EXISTS report_overrides_select ON public.report_overrides;
DROP POLICY IF EXISTS report_overrides_write  ON public.report_overrides;

-- Nessuna restrizione per operatore: chi vede un report deve vedere anche le
-- correzioni applicate, altrimenti leggerebbe numeri diversi dalla direzione.
CREATE POLICY report_overrides_select ON public.report_overrides
  FOR SELECT TO authenticated
  USING (public.dr7_can_reports());

CREATE POLICY report_overrides_write ON public.report_overrides
  FOR ALL TO authenticated
  USING (public.dr7_can_reports())
  WITH CHECK (public.dr7_can_reports());

-- ── VERIFICA ────────────────────────────────────────────────────────────────
-- Nessuna delle due tabelle deve avere policy con qualificatore 'true'.
SELECT tablename, policyname, cmd, qual::text AS using_expr
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN ('acconti_giornalieri', 'report_overrides')
 ORDER BY tablename, policyname;
