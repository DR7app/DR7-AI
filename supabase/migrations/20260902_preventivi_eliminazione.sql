-- ============================================================================
-- Eliminazione preventivi: solo la DIREZIONE, con OTP (02/09/2026)
--
-- Richiesta: nella tab Preventivi non esiste alcun modo di cancellare una
-- riga. Con 776 preventivi accumulati (283 bozze, 426 scaduti) serve poter
-- fare pulizia: riga singola, selezione multipla, o tutto un gruppo di stato.
--
-- Due cose separate, entrambe necessarie:
--
--  1. RLS. La policy storica di 20260404_create_preventivi.sql e'
--     `FOR ALL USING (auth.role() = 'authenticated')`: ogni utente loggato
--     del sito (non solo gli admin — il progetto Supabase e' condiviso col
--     sito pubblico) puo' gia' oggi cancellare preventivi via API. Un gate
--     lato UI sarebbe cosmetico. Qui si aggiunge una policy RESTRICTIVE sul
--     solo DELETE: le restrictive si AND-ano con le permissive, quindi
--     SELECT/INSERT/UPDATE restano identiche a prima (nessun rischio di
--     chiudere fuori chi lavora) e solo la cancellazione si stringe.
--
--  2. Predicato dedicato. `dr7_is_direzione()` NON va usata qui: include
--     anche role:developer, role = 'superadmin' e ophe@dr7.app. Come per gli
--     acconti (20260814000000) si scrive una funzione allineata 1:1 con
--     `hasRole('direzione')` lato client. Vedi memoria rls_must_mirror_ui_role_gate.
--
-- Le Netlify Functions usano la service role e bypassano la RLS: nessun
-- impatto sui flussi server.
-- ============================================================================

-- ── Chi puo' cancellare un preventivo ───────────────────────────────────────
-- SECURITY DEFINER: deve leggere `admins` anche quando la RLS di quella
-- tabella non lo permetterebbe al chiamante.
CREATE OR REPLACE FUNCTION public.dr7_can_delete_preventivi()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Failsafe: la direzione non resta mai chiusa fuori se
    -- `admins.permissions` viene svuotato o corrotto. Stesso elenco di
    -- ROLE_FAILSAFE in useAdminRole.ts, senza ophe@dr7.app: il developer
    -- non ha motivo di cancellare i preventivi della direzione.
    lower(coalesce(auth.jwt() ->> 'email', '')) IN
      ('valerio@dr7.app', 'ilenia@dr7.app')
    OR EXISTS (
      SELECT 1
        FROM public.admins a
       WHERE a.user_id = auth.uid()
         AND a.permissions @> '["role:direzione"]'::jsonb
    );
$$;

COMMENT ON FUNCTION public.dr7_can_delete_preventivi() IS
  'Solo direzione (Valerio/Ilenia o tag role:direzione) puo cancellare righe di preventivi. Volutamente piu stretta di dr7_is_direzione(): esclude developer e superadmin.';

-- ── preventivi: DELETE ristretto ────────────────────────────────────────────
-- RESTRICTIVE = si somma in AND alla policy "Admins can manage preventivi",
-- che resta invariata per SELECT / INSERT / UPDATE.
DROP POLICY IF EXISTS preventivi_delete_solo_direzione ON public.preventivi;
CREATE POLICY preventivi_delete_solo_direzione
  ON public.preventivi
  AS RESTRICTIVE
  FOR DELETE
  USING (public.dr7_can_delete_preventivi());

-- ── Codice OTP configurabile da Gestione OTP ────────────────────────────────
-- is_required = true: la cancellazione e' irreversibile, di default passa
-- dall'autorizzazione direzionale. Resta disattivabile dalla tab OTP —
-- "avviso sempre, blocco mai".
INSERT INTO public.system_otp_overrides (id, label, reason, used_in, is_required, sort_order)
VALUES (
  'preventivo_elimina',
  'Eliminazione Preventivi',
  'Cancellazione definitiva di uno o piu preventivi. Il dato non e recuperabile: sparisce dalla lista, dai conteggi di stato e dai report. Richiede autorizzazione della direzione.',
  'Preventivi (cestino sulla riga, Elimina selezionati, pulizia per stato)',
  true,
  87
)
ON CONFLICT (id) DO NOTHING;

-- ── Verifica ────────────────────────────────────────────────────────────────
SELECT 'otp' AS che_cosa, id, label, is_required::text AS valore
  FROM public.system_otp_overrides
 WHERE id = 'preventivo_elimina'
UNION ALL
SELECT 'policy', policyname, cmd, permissive
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'preventivi';
