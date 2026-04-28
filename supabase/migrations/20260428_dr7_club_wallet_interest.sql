-- ============================================================
-- DR7 Club: 0.1%/day wallet interest, paid out monthly.
--
-- Daily cron (accrue-club-wallet-interest) snapshots each active club
-- member's "card-paid wallet balance" and inserts a row here with
-- accrual_eur = principal × 0.001.
--
-- Monthly cron (payout-club-wallet-interest) sums the prior month's
-- accruals per user, credits the wallet (credit_transactions row of
-- reference_type='club_interest_payout'), and stamps paid_out_at on
-- every accrual row in that month.
--
-- principal_eur is the CARD-PAID portion of the wallet only — bonuses
-- (referrals, milestones, manual credits, this very payout) MUST NOT
-- earn further interest. Calculation lives in the cron function.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.wallet_interest_accruals (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid NOT NULL,
    accrual_date    date NOT NULL,
    principal_eur   numeric(10, 2) NOT NULL CHECK (principal_eur >= 0),
    rate_pct        numeric(5, 4) NOT NULL DEFAULT 0.1000,        -- daily rate %
    accrual_eur     numeric(10, 4) NOT NULL CHECK (accrual_eur >= 0),
    paid_out_at     timestamptz,                                  -- set by monthly payout
    payout_tx_id    uuid,                                         -- credit_transactions.id of the credit
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, accrual_date)
);

CREATE INDEX IF NOT EXISTS idx_wallet_interest_user
    ON public.wallet_interest_accruals (user_id, accrual_date DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_interest_unpaid
    ON public.wallet_interest_accruals (user_id, accrual_date)
    WHERE paid_out_at IS NULL;

ALTER TABLE public.wallet_interest_accruals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read all accruals" ON public.wallet_interest_accruals;
CREATE POLICY "Admins read all accruals"
    ON public.wallet_interest_accruals FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.admins WHERE admins.user_id = auth.uid()));

DROP POLICY IF EXISTS "Users read own accruals" ON public.wallet_interest_accruals;
CREATE POLICY "Users read own accruals"
    ON public.wallet_interest_accruals FOR SELECT
    USING (auth.uid() = user_id);
