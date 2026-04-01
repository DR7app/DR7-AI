-- ============================================================================
-- EMERGENCY RLS LOCKDOWN MIGRATION
-- Data: 2026-04-01
-- Scopo: Abilitare RLS su TUTTE le tabelle public che ne sono prive,
--         revocare grant pericolosi da anon/authenticated,
--         installare event trigger per proteggere tabelle future.
-- Idempotente: SI — sicuro da eseguire piu volte.
-- Rollback: vedi ROLLBACK.sql (rimuove solo trigger, NON riapre tabelle).
-- ============================================================================

-- ===========================================================================
-- FASE 1: ENABLE + FORCE RLS su ogni tabella public senza RLS
-- ===========================================================================
DO $$
DECLARE
    r RECORD;
    cnt INTEGER := 0;
BEGIN
    RAISE NOTICE '=== FASE 1: Abilitazione RLS su tabelle public ===';

    FOR r IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'              -- solo tabelle base (no views, no sequences)
          AND NOT c.relrowsecurity          -- RLS non ancora abilitato
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);
        RAISE NOTICE 'RLS abilitato e forzato su: public.%', r.table_name;
        cnt := cnt + 1;
    END LOOP;

    RAISE NOTICE '=== FASE 1 completata: % tabelle protette ===', cnt;
END
$$;

-- ===========================================================================
-- FASE 2: FORCE RLS su tabelle che hanno RLS abilitato ma NON forzato
-- (copre tabelle migrate precedentemente senza FORCE)
-- ===========================================================================
DO $$
DECLARE
    r RECORD;
    cnt INTEGER := 0;
BEGIN
    RAISE NOTICE '=== FASE 2: FORCE RLS su tabelle con RLS abilitato ma non forzato ===';

    FOR r IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relrowsecurity              -- RLS abilitato
          AND NOT c.relforcerowsecurity      -- ma NON forzato
        ORDER BY c.relname
    LOOP
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.table_name);
        RAISE NOTICE 'FORCE RLS aggiunto su: public.%', r.table_name;
        cnt := cnt + 1;
    END LOOP;

    RAISE NOTICE '=== FASE 2 completata: % tabelle aggiornate ===', cnt;
END
$$;

-- ===========================================================================
-- FASE 3: Revoca privilegi pericolosi da anon su TUTTE le tabelle public
-- (anon NON dovrebbe avere accesso diretto a tabelle — tutto via service_role)
-- ===========================================================================
DO $$
DECLARE
    r RECORD;
    cnt INTEGER := 0;
BEGIN
    RAISE NOTICE '=== FASE 3: Revoca privilegi anon ===';

    FOR r IN
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        ORDER BY c.relname
    LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', r.table_name);
        RAISE NOTICE 'Revocati tutti i privilegi anon su: public.%', r.table_name;
        cnt := cnt + 1;
    END LOOP;

    RAISE NOTICE '=== FASE 3 completata: revocati privilegi anon su % tabelle ===', cnt;
END
$$;

-- ===========================================================================
-- FASE 4: Rimozione policy pericolose che usano ruolo anon con USING(true)
-- (le policy per anon restano definite ma il REVOKE sopra le rende inoperanti;
--  qui le rimuoviamo per pulizia, evitando che un futuro GRANT le riattivi)
-- ===========================================================================
DO $$
DECLARE
    r RECORD;
    cnt INTEGER := 0;
BEGIN
    RAISE NOTICE '=== FASE 4: Rimozione policy anon pericolose ===';

    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND (roles::text LIKE '%anon%' OR roles::text LIKE '%{anon}%')
        ORDER BY tablename, policyname
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
        RAISE NOTICE 'Rimossa policy anon: %.% -> %', r.schemaname, r.tablename, r.policyname;
        cnt := cnt + 1;
    END LOOP;

    -- Rimuovi anche le policy con ruolo "public" (= tutti, incluso anon)
    FOR r IN
        SELECT schemaname, tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND roles::text = '{public}'
        ORDER BY tablename, policyname
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
        RAISE NOTICE 'Rimossa policy pubblica: %.% -> %', r.schemaname, r.tablename, r.policyname;
        cnt := cnt + 1;
    END LOOP;

    RAISE NOTICE '=== FASE 4 completata: % policy rimosse ===', cnt;
END
$$;

-- ===========================================================================
-- FASE 5: Event trigger per proteggere automaticamente tabelle future
-- ===========================================================================

-- 5a. Funzione che abilita RLS su tabelle appena create in public
CREATE OR REPLACE FUNCTION public.fn_auto_enable_rls()
RETURNS event_trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    obj RECORD;
BEGIN
    FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
    LOOP
        -- Solo CREATE TABLE nello schema public
        IF obj.command_tag = 'CREATE TABLE'
           AND obj.schema_name = 'public'
           AND obj.object_type = 'table'
        THEN
            EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
            EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', obj.object_identity);
            EXECUTE format('REVOKE ALL ON %s FROM anon', obj.object_identity);
            RAISE NOTICE '[AUTO-RLS] Protetta nuova tabella: %', obj.object_identity;
        END IF;
    END LOOP;
END
$$;

-- 5b. Rimuovi trigger esistente se presente (idempotenza)
DROP EVENT TRIGGER IF EXISTS trg_auto_enable_rls;

-- 5c. Crea event trigger
CREATE EVENT TRIGGER trg_auto_enable_rls
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.fn_auto_enable_rls();

COMMENT ON FUNCTION public.fn_auto_enable_rls() IS
'[SECURITY] Abilita automaticamente RLS + FORCE RLS + revoca anon su ogni nuova tabella public.';

-- ===========================================================================
-- FASE 6: Verifica immediata post-migrazione
-- ===========================================================================
DO $$
DECLARE
    unprotected INTEGER;
BEGIN
    SELECT count(*) INTO unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

    IF unprotected > 0 THEN
        RAISE WARNING '!!! ATTENZIONE: % tabelle public ancora senza RLS completo !!!', unprotected;
    ELSE
        RAISE NOTICE '=== VERIFICA OK: tutte le tabelle public hanno RLS abilitato e forzato ===';
    END IF;
END
$$;

-- ============================================================================
-- FINE EMERGENCY MIGRATION
-- ============================================================================
