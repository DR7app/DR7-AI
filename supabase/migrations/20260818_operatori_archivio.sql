-- Operatori archiviati: si toglie l'ACCESSO, si tiene TUTTA la storia.
--
-- Richiesta direzione (18/08/2026): un operatore che se ne va non va
-- cancellato — orari, contratti, acconti e log restano — ma non deve piu'
-- poter entrare nel gestionale. Finisce nella sotto-tab "Storico" di Operatori.
--
-- Perche' una colonna dedicata e non il campo `stato`: `stato` e' testo libero
-- digitato a mano in scheda ("Attivo / Sospeso / Inattivo"), quindi un refuso
-- basterebbe a riaprire o chiudere un accesso. Su una cosa di sicurezza serve
-- un dato non ambiguo.
ALTER TABLE public.admins
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID;

COMMENT ON COLUMN public.admins.archived_at IS
  'Valorizzata = operatore archiviato: nessun accesso al gestionale, riga e storico conservati. NULL = attivo.';
COMMENT ON COLUMN public.admins.archived_by IS
  'admins.id di chi ha archiviato.';

CREATE INDEX IF NOT EXISTS idx_admins_archived_at ON public.admins (archived_at);

-- ── Gli helper RLS devono IGNORARE gli archiviati ───────────────────────────
-- Senza questo, un archiviato resterebbe "admin" a livello di database: la UI
-- lo blocca, ma il suo token potrebbe ancora leggere/scrivere via API.
CREATE OR REPLACE FUNCTION public.dr7_admin_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id FROM public.admins a
   WHERE a.user_id = auth.uid() AND a.archived_at IS NULL
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.dr7_admin_nome()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.nome FROM public.admins a
   WHERE a.user_id = auth.uid() AND a.archived_at IS NULL
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.dr7_is_direzione()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app', 'ophe@dr7.app')
    OR EXISTS (
      SELECT 1 FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.archived_at IS NULL
         AND ( a.role = 'superadmin'
               OR a.permissions @> '["role:direzione"]'::jsonb
               OR a.permissions @> '["role:developer"]'::jsonb )
    );
$$;

CREATE OR REPLACE FUNCTION public.dr7_can_see_all_acconti()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app')
    OR EXISTS (
      SELECT 1 FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.archived_at IS NULL
         AND a.permissions @> '["role:direzione"]'::jsonb
    );
$$;

-- ── Verifica ────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE archived_at IS NULL) AS attivi,
       count(*) FILTER (WHERE archived_at IS NOT NULL) AS archiviati
  FROM public.admins;
