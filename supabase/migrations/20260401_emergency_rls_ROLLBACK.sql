-- ============================================================================
-- ROLLBACK.sql — Rollback PARZIALE della migrazione RLS lockdown
--
-- ATTENZIONE: questo rollback rimuove SOLO l'event trigger automatico.
-- NON disabilita RLS sulle tabelle — questo e intenzionale.
-- Riaprire le tabelle richiederebbe un intervento manuale e consapevole.
-- ============================================================================

-- ===========================================================================
-- 1. Rimuovi event trigger
-- ===========================================================================
DROP EVENT TRIGGER IF EXISTS trg_auto_enable_rls;

-- ===========================================================================
-- 2. Rimuovi funzione associata
-- ===========================================================================
DROP FUNCTION IF EXISTS public.fn_auto_enable_rls();

-- ===========================================================================
-- 3. Verifica rimozione
-- ===========================================================================
DO $$
DECLARE
    trigger_exists BOOLEAN;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_event_trigger WHERE evtname = 'trg_auto_enable_rls'
    ) INTO trigger_exists;

    IF trigger_exists THEN
        RAISE WARNING 'Event trigger trg_auto_enable_rls ancora presente!';
    ELSE
        RAISE NOTICE 'Rollback completato: event trigger e funzione rimossi.';
    END IF;

    RAISE NOTICE 'NOTA: RLS resta abilitato su tutte le tabelle. Per disabilitarlo su una tabella specifica:';
    RAISE NOTICE '  ALTER TABLE public.<nome_tabella> DISABLE ROW LEVEL SECURITY;';
    RAISE NOTICE '  ALTER TABLE public.<nome_tabella> NO FORCE ROW LEVEL SECURITY;';
END
$$;

-- ============================================================================
-- FINE ROLLBACK
-- ============================================================================
