-- Purpose:
--   Many logAdminAction calls silently fail to INSERT because admin_activity_log
--   had a CHECK constraint restricting `action` to a fixed enum of legacy values.
--   New actions (preventivo_created, preventivo_sent, whatsapp_sent, etc.) were
--   rejected. This drops ANY check constraint on the table so the audit log
--   stops eating new event types.
--
-- Safe to re-run — uses IF EXISTS style lookup.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_class cls ON cls.oid = con.conrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE cls.relname = 'admin_activity_log'
          AND ns.nspname = 'public'
          AND con.contype = 'c'
    LOOP
        EXECUTE format('ALTER TABLE public.admin_activity_log DROP CONSTRAINT %I', r.conname);
        RAISE NOTICE 'Dropped CHECK constraint: %', r.conname;
    END LOOP;
END $$;
