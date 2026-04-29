-- ============================================================
-- Promo Incassi — fix dedup: ONE PROMO TOTAL per recipient per month.
--
-- Original migration locked the unique key to (vehicle, year_month,
-- threshold_coeff, recipient) which let the cron fire a NEW message every
-- time the active coefficient dropped to a lower tier (0.8 → 0.7 → 0.6),
-- effectively spamming the recipient. Even relaxed to (vehicle, month,
-- recipient) the same person still received one message per triggering
-- vehicle — also unwanted.
--
-- Final rule: at most ONE promo per (year_month, recipient). The cron
-- picks the best deal (lowest coefficient) per recipient and sends one
-- message. Any second insert for the same person in the same month
-- raises 23505 and gets skipped silently.
-- ============================================================

-- Step 1: clean any duplicates left over from the broken builds.
DELETE FROM public.promo_incassi_sent_log a
USING public.promo_incassi_sent_log b
WHERE a.year_month = b.year_month
  AND a.recipient  = b.recipient
  AND a.sent_at    > b.sent_at;

-- Step 2: recreate the unique index without vehicle_id / threshold_coeff.
DROP INDEX IF EXISTS public.idx_promo_incassi_sent_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_incassi_sent_unique
    ON public.promo_incassi_sent_log (year_month, recipient);
