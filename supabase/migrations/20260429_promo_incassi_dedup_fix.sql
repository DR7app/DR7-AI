-- ============================================================
-- Promo Incassi — final dedup rule:
--   ONE message per (vehicle, year_month, recipient).
--
-- Each customer can receive one promo per vehicle per month. Two
-- vehicles crossing threshold = two messages (one for each vehicle),
-- but no duplicates of the same vehicle.
--
-- The original migration's index included threshold_coeff, which let
-- the cron fire a NEW message every time a vehicle's active coefficient
-- dropped to a lower tier (0.8 → 0.7 → 0.6). This migration cleans
-- those duplicates and recreates the index without threshold_coeff.
-- ============================================================

-- Step 1: clean any duplicates produced by the buggy builds.
DELETE FROM public.promo_incassi_sent_log a
USING public.promo_incassi_sent_log b
WHERE a.vehicle_id = b.vehicle_id
  AND a.year_month = b.year_month
  AND a.recipient  = b.recipient
  AND a.sent_at    > b.sent_at;

-- Step 2: drop any prior unique index (regardless of which earlier
-- iteration of this migration created it) and recreate it as
-- (vehicle_id, year_month, recipient).
DROP INDEX IF EXISTS public.idx_promo_incassi_sent_unique;

CREATE UNIQUE INDEX idx_promo_incassi_sent_unique
    ON public.promo_incassi_sent_log (vehicle_id, year_month, recipient);
