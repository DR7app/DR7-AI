-- ============================================================
-- Promo Incassi — automated WhatsApp blast when a vehicle reaches its
-- monthly revenue target's 0.7-or-lower coefficient threshold.
--
-- Two tables:
--   1. promo_incassi_settings  — singleton runtime config (mode + pilot phone)
--   2. promo_incassi_sent_log  — dedup ledger so each (vehicle, year_month,
--                                threshold_coeff, recipient) only fires once
--
-- Mode values:
--   'off'       — cron does nothing
--   'pilot'     — sends only to pilot_phone
--   'broadcast' — sends to every customers_extended row with a phone number
-- ============================================================

CREATE TABLE IF NOT EXISTS public.promo_incassi_settings (
    id           integer PRIMARY KEY DEFAULT 1,
    mode         text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'pilot', 'broadcast')),
    pilot_phone  text,
    -- Trigger threshold. Default 0.8: fire when the vehicle's active
    -- monthly target coefficient drops to 0.8 or below for the first time
    -- this month.
    threshold_coeff numeric NOT NULL DEFAULT 0.8,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT singleton CHECK (id = 1)
);

INSERT INTO public.promo_incassi_settings (id, mode) VALUES (1, 'off')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.promo_incassi_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read promo_incassi_settings" ON public.promo_incassi_settings;
CREATE POLICY "Admins can read promo_incassi_settings"
    ON public.promo_incassi_settings FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

DROP POLICY IF EXISTS "Admins can write promo_incassi_settings" ON public.promo_incassi_settings;
CREATE POLICY "Admins can write promo_incassi_settings"
    ON public.promo_incassi_settings FOR ALL
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));


-- ── Dedup ledger ───────────────────────────────────────────
-- One row per (vehicle, month, threshold_coeff, recipient) that successfully
-- received the promo. Cron checks this table before sending; if a matching
-- row already exists, the recipient is skipped.
CREATE TABLE IF NOT EXISTS public.promo_incassi_sent_log (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id      uuid NOT NULL,
    year_month      text NOT NULL,                 -- 'YYYY-MM' Europe/Rome
    threshold_coeff numeric NOT NULL,
    recipient       text NOT NULL,
    template_key    text,
    sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_incassi_sent_unique
    ON public.promo_incassi_sent_log (vehicle_id, year_month, threshold_coeff, recipient);

CREATE INDEX IF NOT EXISTS idx_promo_incassi_sent_lookup
    ON public.promo_incassi_sent_log (vehicle_id, year_month);

ALTER TABLE public.promo_incassi_sent_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read promo_incassi_sent_log" ON public.promo_incassi_sent_log;
CREATE POLICY "Admins can read promo_incassi_sent_log"
    ON public.promo_incassi_sent_log FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));
