-- ============================================================
-- Promo Incassi — fix dedup: one promo per vehicle per month per recipient.
--
-- Original migration locked the unique key to (vehicle, year_month,
-- threshold_coeff, recipient) which let the cron fire a NEW message every
-- time the active coefficient dropped to a lower tier (0.8 → 0.7 → 0.6),
-- effectively spamming the recipient. Drop that index and replace with one
-- that ignores threshold_coeff so we send at most one promo per vehicle
-- per month per recipient.
-- ============================================================

DROP INDEX IF EXISTS public.idx_promo_incassi_sent_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_incassi_sent_unique
    ON public.promo_incassi_sent_log (vehicle_id, year_month, recipient);
