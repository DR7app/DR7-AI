-- ============================================================================
-- VERIFY.sql — Query di verifica post-migrazione RLS lockdown
-- Eseguire nel Supabase SQL Editor DOPO la migrazione.
-- Tutte le query sono SELECT — nessuna modifica.
-- ============================================================================

-- ===========================================================================
-- 1. Stato RLS di TUTTE le tabelle public
-- Risultato atteso: tutte le righe devono avere rls_enabled = true, rls_forced = true
-- ===========================================================================
SELECT
    c.relname                       AS tabella,
    c.relrowsecurity                AS rls_enabled,
    c.relforcerowsecurity           AS rls_forced,
    CASE
        WHEN c.relrowsecurity AND c.relforcerowsecurity THEN 'OK'
        WHEN c.relrowsecurity AND NOT c.relforcerowsecurity THEN 'WARN: non forzato'
        ELSE 'CRITICO: RLS disabilitato'
    END                             AS stato
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY stato DESC, c.relname;

-- ===========================================================================
-- 2. Grant residui verso anon su tabelle public
-- Risultato atteso: nessuna riga (anon non deve avere accesso diretto)
-- ===========================================================================
SELECT
    table_schema,
    table_name,
    privilege_type,
    grantee
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee = 'anon'
ORDER BY table_name, privilege_type;

-- ===========================================================================
-- 3. Grant verso authenticated su tabelle public
-- (informativo — authenticated puo avere accesso, ma da verificare per coerenza)
-- ===========================================================================
SELECT
    table_schema,
    table_name,
    privilege_type,
    grantee
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND grantee = 'authenticated'
ORDER BY table_name, privilege_type;

-- ===========================================================================
-- 4. Tutte le policy RLS attive su tabelle public
-- Mostra quali tabelle hanno policy e quali no (lockdown = no policy = nessun accesso)
-- ===========================================================================
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual        AS using_expression,
    with_check  AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- ===========================================================================
-- 5. Tabelle public SENZA alcuna policy (lockdown totale — solo service_role)
-- Queste tabelle sono accessibili SOLO via service_role (backend Netlify functions)
-- ===========================================================================
SELECT c.relname AS tabella_senza_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = c.relname
  )
ORDER BY c.relname;

-- ===========================================================================
-- 6. Verifica event trigger installato
-- Risultato atteso: una riga con trg_auto_enable_rls
-- ===========================================================================
SELECT
    evtname     AS trigger_name,
    evtevent    AS event,
    evtenabled  AS enabled,
    evtfoid::regproc AS function_name
FROM pg_event_trigger
WHERE evtname = 'trg_auto_enable_rls';

-- ===========================================================================
-- 7. Conteggio riepilogativo
-- ===========================================================================
SELECT
    count(*) FILTER (WHERE c.relrowsecurity AND c.relforcerowsecurity)   AS tabelle_protette,
    count(*) FILTER (WHERE NOT c.relrowsecurity)                          AS tabelle_senza_rls,
    count(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) AS tabelle_rls_non_forzato,
    count(*)                                                               AS tabelle_totali
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r';

-- ============================================================================
-- FINE VERIFY
-- ============================================================================
