-- Per-operator tab permissions.
-- Adds a JSONB array column on `admins`. The wildcard token '*' means
-- "full access" (used for direzione / superadmin). Otherwise the array
-- holds the exact tab keys (matching TabType in AdminDashboard.tsx) the
-- operator is allowed to open.

ALTER TABLE admins
  ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Backfill 1: direzione + superadmin get wildcard.
UPDATE admins
SET permissions = '["*"]'::jsonb
WHERE role = 'superadmin'
   OR LOWER(email) IN ('valerio@dr7.app', 'ilenia@dr7.app');

-- Backfill 2: existing 'admin' rows get a default "operatore" permission
-- set that mirrors what they could see before this migration. Direzione
-- can tighten/expand each operator individually from the new UI.
--
-- Excluded by default (financial — previously gated by can_view_financials):
--   fattura, nexi, unpaid, cauzioni
-- Excluded by default (admin-only — previously gated for non-superadmin):
--   reports, report-noleggio, report-lavaggio, report-clienti, report-traffic
--
-- Operators with can_view_financials=true get the financial tabs added back.

UPDATE admins
SET permissions = jsonb_build_array(
  'reservations', 'report-preventivi', 'customers', 'vehicles', 'calendar',
  'carwash', 'carwash-calendar', 'carwash-catalog', 'contratto',
  'marketing-pro', 'campagna-marketing', 'reviews', 'fleet', 'scanner',
  'birthdays', 'scadenze', 'bulk-import', 'referral', 'gestione-danni',
  'gestione-multe', 'gps-keyless', 'codice-sconto', 'report-penali-danni',
  'customer-wallet', 'com-email', 'com-pec', 'com-whatsapp', 'com-sms',
  'com-chiamate', 'com-chatgpt', 'com-aruba', 'cargos', 'trustera', 'emtn',
  'operatori', 'rilevazione-orari', 'dashboard-kpi', 'revenue-pricing',
  'site-users', 'centralina-pro', 'maxi-promo-gap', 'promo-incassi',
  'gestione-otp', 'verifica-documenti', 'fornitori'
)
WHERE permissions = '[]'::jsonb
  AND role <> 'superadmin';

-- Add financial tabs back for admins who already had can_view_financials=true.
UPDATE admins
SET permissions = permissions || '["fattura", "nexi", "unpaid", "cauzioni"]'::jsonb
WHERE role <> 'superadmin'
  AND can_view_financials = true
  AND NOT (permissions @> '["*"]'::jsonb);

-- Helpful index for permission membership lookups (ANY operator querying
-- their own row goes through this).
CREATE INDEX IF NOT EXISTS idx_admins_permissions ON admins USING GIN (permissions);

COMMENT ON COLUMN admins.permissions IS
  'Array of TabType keys the operator can open. Special token "*" = full access (direzione/superadmin).';
