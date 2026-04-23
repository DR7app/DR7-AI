-- ROOT CAUSE: the 2026-04-01 emergency RLS lockdown dropped every policy on
-- `contracts` for non-service-role clients. That means:
--   • Netlify functions (service_role) can still INSERT/UPDATE/SELECT.
--   • The admin UI (authenticated JWT) gets null back from every SELECT on
--     contracts — so "Rinvia contratto" etc. report "Contratto non trovato"
--     even though the row was just inserted.
--
-- This migration reinstates admin read/write access to contracts.
-- Service_role is unaffected — it bypasses RLS regardless.

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contracts_admin_full_access" ON public.contracts;
CREATE POLICY "contracts_admin_full_access"
  ON public.contracts
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON POLICY "contracts_admin_full_access" ON public.contracts IS
  'Restored by 20260423 migration. Previously removed by 20260401_emergency_rls_lockdown.sql, which unintentionally blocked admin reads and broke the contract-regeneration / signing-link flows.';
